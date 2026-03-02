//! Static Action Detection via OXC Semantic Analysis
//!
//! Purpose:
//! Bypass V8 entirely for actions that return constant/static values.
//! Uses OXC (Oxidation Compiler) to parse JavaScript into a real AST and
//! perform semantic analysis with constant propagation.
//!
//! Mechanism:
//! 1. Parses bundled action files (.jsbundle) with OXC.
//! 2. Builds semantic data (symbol table, scopes).
//! 3. Evaluates `t.response.json/text/html()` calls for static constancy.
//! 4. If all calls produce the same static value, the action is fast-pathed.
//!
//! Dependencies:
//! Requires `oxc` crate with "semantic" feature.

use bytes::Bytes;
use std::collections::HashMap;
use std::fs;
use std::path::Path;

use oxc::allocator::Allocator;
use oxc::ast::AstKind;
use oxc::ast::ast::*;
use oxc::parser::Parser;
use oxc::semantic::SemanticBuilder;
use oxc::span::SourceType;

/// A pre-computed HTTP response for a static action.
#[derive(Clone, Debug)]
pub struct StaticResponse {
    pub body: Bytes,
    pub content_type: &'static str,
    pub status: u16,
    pub extra_headers: Vec<(String, String)>,
}

impl PartialEq for StaticResponse {
    fn eq(&self, other: &Self) -> bool {
        self.body == other.body
            && self.content_type == other.content_type
            && self.status == other.status
            && self.extra_headers == other.extra_headers
    }
}

/// Options extracted from the second argument of t.response.*() call.
#[derive(Clone, Debug, Default)]
struct ResponseOptions {
    status: u16,
    headers: Vec<(String, String)>,
}

/// Registry of actions that have been detected as static.
#[derive(Clone)]
pub struct FastPathRegistry {
    actions: HashMap<String, StaticResponse>,
}

impl FastPathRegistry {
    /// Build a FastPathRegistry by scanning action files in the given directory.
    pub fn build(actions_dir: &Path) -> Self {
        let mut actions = HashMap::new();

        if !actions_dir.exists() || !actions_dir.is_dir() {
            return Self { actions };
        }

        if let Ok(entries) = fs::read_dir(actions_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() {
                    continue;
                }

                let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
                if ext != "js" && ext != "jsbundle" {
                    continue;
                }

                let name = path
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();

                if name.is_empty() {
                    continue;
                }

                if let Ok(source) = fs::read_to_string(&path) {
                    if let Some(resp) = analyze_action_source(&source) {
                        let header_info = if resp.extra_headers.is_empty() {
                            String::new()
                        } else {
                            format!(" +{}h", resp.extra_headers.len())
                        };
                        let status_info = if resp.status != 200 {
                            format!(" [{}]", resp.status)
                        } else {
                            String::new()
                        };
                        println!(
                            "\x1b[36m[Titan FastPath]\x1b[0m \x1b[32m✔\x1b[0m Action '{}' → static {} ({} bytes{}{})",
                            name, resp.content_type, resp.body.len(), status_info, header_info
                        );
                        actions.insert(name, resp);
                    }
                }
            }
        }

        if !actions.is_empty() {
            println!(
                "\x1b[36m[Titan FastPath]\x1b[0m {} action(s) will bypass V8",
                actions.len()
            );
        }

        Self { actions }
    }

    /// Check if an action has a fast-path static response.
    #[inline(always)]
    pub fn get(&self, action_name: &str) -> Option<&StaticResponse> {
        self.actions.get(action_name)
    }

    /// Number of registered fast-path actions.
    pub fn len(&self) -> usize {
        self.actions.len()
    }
}

impl StaticResponse {
    /// Convert to an Axum response. Uses Bytes::clone() which is O(1) ref-count bump.
    #[inline(always)]
    pub fn to_axum_response(&self) -> axum::response::Response<axum::body::Body> {
        let mut builder = axum::response::Response::builder()
            .status(self.status)
            .header("content-type", self.content_type)
            .header("server", "TitanPL");

        for (key, val) in &self.extra_headers {
            let lower = key.to_lowercase();
            if lower == "content-type" || lower == "server" {
                continue;
            }
            builder = builder.header(key.as_str(), val.as_str());
        }

        builder
            .body(axum::body::Body::from(self.body.clone()))
            .unwrap()
    }
}

/// A pre-computed response for static reply routes (t.get("/").reply("ok")).
#[derive(Clone, Debug)]
pub struct PrecomputedRoute {
    pub body: Bytes,
    pub content_type: &'static str,
}

impl PrecomputedRoute {
    /// Create from a JSON serde_json::Value (for .reply({...}) routes)
    pub fn from_json(val: &serde_json::Value) -> Self {
        let body = serde_json::to_vec(val).unwrap_or_default();
        Self {
            body: Bytes::from(body),
            content_type: "application/json",
        }
    }

    /// Create from a text string (for .reply("text") routes)
    pub fn from_text(text: &str) -> Self {
        Self {
            body: Bytes::from(text.to_string()),
            content_type: "text/plain; charset=utf-8",
        }
    }

    /// Convert to Axum response. O(1) body clone via Bytes refcount.
    #[inline(always)]
    pub fn to_axum_response(&self) -> axum::response::Response<axum::body::Body> {
        axum::response::Response::builder()
            .status(200u16)
            .header("content-type", self.content_type)
            .header("server", "TitanPL")
            .body(axum::body::Body::from(self.body.clone()))
            .unwrap()
    }
}

/// Maximum recursion depth for static expression evaluation.
const MAX_EVAL_DEPTH: usize = 16;

/// Analyze a bundled action's source code using OXC semantic analysis.
fn analyze_action_source(source: &str) -> Option<StaticResponse> {
    // Phase 1: Parse
    let allocator = Allocator::default();
    let source_type = SourceType::mjs(); // ES module JavaScript
    let parser_ret = Parser::new(&allocator, source, source_type).parse();

    if parser_ret.panicked {
        return None;
    }

    // Phase 2: Semantic analysis
    // Builds symbol table, resolves all identifier references to their
    // declaring symbols, and tracks read/write counts per symbol.
    let semantic_ret = SemanticBuilder::new().build(&parser_ret.program);
    let semantic = &semantic_ret.semantic;

    // Phase 3: Find and evaluate t.response.json/text/html() calls
    let mut responses: Vec<StaticResponse> = Vec::new();
    let mut has_dynamic = false;

    for node in semantic.nodes().iter() {
        if let AstKind::CallExpression(call) = node.kind() {
            if let Some(method) = detect_response_method(call) {
                analyze_response_call(call, method, semantic, &mut responses, &mut has_dynamic);
            }
        }
    }

    if has_dynamic || responses.is_empty() {
        return None;
    }

    unique_response(&responses)
}

/// Detect if a CallExpression is `t.response.json(...)`, `t.response.text(...)`,
/// or `t.response.html(...)`. Returns the method name if matched.
fn detect_response_method<'a>(call: &CallExpression<'a>) -> Option<&'a str> {
    // Callee must be: t.response.<method>
    let outer = match &call.callee {
        Expression::StaticMemberExpression(m) => m.as_ref(),
        _ => return None,
    };

    let method = outer.property.name.as_str();
    if method != "json" && method != "text" && method != "html" {
        return None;
    }

    let inner = match &outer.object {
        Expression::StaticMemberExpression(m) => m.as_ref(),
        _ => return None,
    };

    if inner.property.name.as_str() != "response" {
        return None;
    }

    match &inner.object {
        Expression::Identifier(ident) if ident.name.as_str() == "t" => Some(method),
        _ => None,
    }
}

/// Analyze a single t.response.*() call and attempt to produce a StaticResponse.
fn analyze_response_call<'a>(
    call: &CallExpression<'a>,
    method: &str,
    semantic: &oxc::semantic::Semantic<'a>,
    responses: &mut Vec<StaticResponse>,
    has_dynamic: &mut bool,
) {
    // First argument: the body (required)
    let body_arg = match call.arguments.first() {
        Some(arg) => arg,
        None => return,
    };

    let body_expr = match body_arg {
        Argument::SpreadElement(_) => {
            *has_dynamic = true;
            return;
        }
        arg => arg.as_expression().unwrap(),
    };

    // Second argument: options { headers: {...}, status: N } (optional)
    let opts_expr = call.arguments.get(1).and_then(|arg| match arg {
        Argument::SpreadElement(_) => None,
        arg => arg.as_expression(),
    });

    // Evaluate the body statically
    let body_value = match eval_static(body_expr, semantic, 0) {
        Some(v) => v,
        None => {
            *has_dynamic = true;
            return;
        }
    };

    // Evaluate options if present
    let options = if let Some(opts) = opts_expr {
        match eval_static(opts, semantic, 0) {
            Some(v) => extract_response_options(&v),
            None => {
                *has_dynamic = true;
                return;
            }
        }
    } else {
        ResponseOptions {
            status: 200,
            headers: Vec::new(),
        }
    };

    // Build the StaticResponse based on the method type
    let (serialized_body, content_type) = match method {
        "json" => {
            match serde_json::to_vec(&body_value) {
                Ok(bytes) => (bytes, "application/json"),
                Err(_) => {
                    *has_dynamic = true;
                    return;
                }
            }
        }
        "text" => {
            match body_value.as_str() {
                Some(s) => (s.as_bytes().to_vec(), "text/plain"),
                None => {
                    *has_dynamic = true;
                    return;
                }
            }
        }
        "html" => {
            match body_value.as_str() {
                Some(s) => (s.as_bytes().to_vec(), "text/html"),
                None => {
                    *has_dynamic = true;
                    return;
                }
            }
        }
        _ => {
            *has_dynamic = true;
            return;
        }
    };

    responses.push(StaticResponse {
        body: Bytes::from(serialized_body),
        content_type,
        status: options.status,
        extra_headers: options.headers,
    });
}

/// If all responses are identical, return that response. Otherwise None.
fn unique_response(responses: &[StaticResponse]) -> Option<StaticResponse> {
    if responses.is_empty() {
        return None;
    }
    let first = &responses[0];
    if responses.iter().all(|r| r == first) {
        Some(first.clone())
    } else {
        None
    }
}

/// Recursively evaluate a JavaScript expression to a serde_json::Value.
///
/// Returns `Some(value)` if the expression is provably static (constant).
/// Returns `None` if the expression depends on runtime values (dynamic).
fn eval_static<'a>(
    expr: &Expression<'a>,
    semantic: &oxc::semantic::Semantic<'a>,
    depth: usize,
) -> Option<serde_json::Value> {
    use serde_json::Value;

    if depth > MAX_EVAL_DEPTH {
        return None;
    }

    match expr {
        // Literals
        Expression::StringLiteral(lit) => {
            Some(Value::String(lit.value.to_string()))
        }
        Expression::NumericLiteral(lit) => {
            number_to_json(lit.value)
        }
        Expression::BooleanLiteral(lit) => {
            Some(Value::Bool(lit.value))
        }
        Expression::NullLiteral(_) => {
            Some(Value::Null)
        }

        // Object Expression
        Expression::ObjectExpression(obj) => {
            let mut map = serde_json::Map::with_capacity(obj.properties.len());

            for prop in &obj.properties {
                match prop {
                    ObjectPropertyKind::ObjectProperty(p) => {
                        let key = property_key_to_string(&p.key)?;
                        let val = eval_static(&p.value, semantic, depth + 1)?;
                        map.insert(key, val);
                    }
                    ObjectPropertyKind::SpreadProperty(_) => return None,
                }
            }
            Some(Value::Object(map))
        }

        // Array Expression
        Expression::ArrayExpression(arr) => {
            let mut vec = Vec::with_capacity(arr.elements.len());

            for elem in &arr.elements {
                match elem {
                    ArrayExpressionElement::SpreadElement(_) => return None,
                    ArrayExpressionElement::Elision(_) => {
                        vec.push(Value::Null); // holes become null in JSON
                    }
                    _ => {
                        if let Some(expr) = elem.as_expression() {
                            vec.push(eval_static(expr, semantic, depth + 1)?);
                        } else {
                            return None;
                        }
                    }
                }
            }
            Some(Value::Array(vec))
        }

        // Identifier Reference
        Expression::Identifier(ident) => {
            resolve_identifier(ident, semantic, depth)
        }

        // Template Literal
        Expression::TemplateLiteral(tpl) => {
            if tpl.expressions.is_empty() {
                let s = tpl.quasis.iter()
                    .filter_map(|q| q.value.cooked.as_ref())
                    .map(|a| a.as_str())
                    .collect::<String>();
                return Some(Value::String(s));
            }

            let mut result = String::new();

            for (i, quasi) in tpl.quasis.iter().enumerate() {
                if let Some(cooked) = &quasi.value.cooked {
                    result.push_str(cooked.as_str());
                } else {
                    return None;
                }

                if i < tpl.expressions.len() {
                    let val = eval_static(&tpl.expressions[i], semantic, depth + 1)?;
                    match val {
                        Value::String(s) => result.push_str(&s),
                        Value::Number(n) => result.push_str(&n.to_string()),
                        Value::Bool(b) => result.push_str(if b { "true" } else { "false" }),
                        Value::Null => result.push_str("null"),
                        _ => return None,
                    }
                }
            }
            Some(Value::String(result))
        }

        // Binary Expression
        Expression::BinaryExpression(bin) => {
            if bin.operator != BinaryOperator::Addition {
                return None;
            }

            let left = eval_static(&bin.left, semantic, depth + 1)?;
            let right = eval_static(&bin.right, semantic, depth + 1)?;

            match (&left, &right) {
                (Value::String(l), Value::String(r)) => {
                    Some(Value::String(format!("{}{}", l, r)))
                }
                (Value::String(l), Value::Number(r)) => {
                    Some(Value::String(format!("{}{}", l, r)))
                }
                (Value::Number(l), Value::String(r)) => {
                    Some(Value::String(format!("{}{}", l, r)))
                }
                (Value::Number(l), Value::Number(r)) => {
                    let lv = l.as_f64()?;
                    let rv = r.as_f64()?;
                    number_to_json(lv + rv)
                }
                _ => None,
            }
        }

        // Unary Expression
        Expression::UnaryExpression(unary) => {
            if unary.operator != UnaryOperator::UnaryNegation {
                return None;
            }
            let val = eval_static(&unary.argument, semantic, depth + 1)?;
            match val {
                Value::Number(n) => {
                    let v = n.as_f64()?;
                    number_to_json(-v)
                }
                _ => None,
            }
        }

        // Parenthesized
        Expression::ParenthesizedExpression(paren) => {
            eval_static(&paren.expression, semantic, depth)
        }

        _ => None,
    }
}

/// Resolve an IdentifierReference to a static value using OXC's semantic analysis.
fn resolve_identifier<'a>(
    ident: &IdentifierReference<'a>,
    semantic: &oxc::semantic::Semantic<'a>,
    depth: usize,
) -> Option<serde_json::Value> {
    if depth > MAX_EVAL_DEPTH {
        return None;
    }

    let ref_id = ident.reference_id.get()?;
    let scoping = semantic.scoping();
    let reference = scoping.get_reference(ref_id);
    let symbol_id = reference.symbol_id()?;

    if scoping.symbol_is_mutated(symbol_id) {
        return None;
    }

    let decl_node_id = scoping.symbol_declaration(symbol_id);
    let decl_node = semantic.nodes().get_node(decl_node_id);

    match decl_node.kind() {
        AstKind::VariableDeclarator(declarator) => {
            if let Some(init) = &declarator.init {
                match init {
                    Expression::ArrayExpression(_) | Expression::ObjectExpression(_) => {
                        if is_object_mutated_in_ast(symbol_id, semantic) {
                            None
                        } else {
                            eval_static(init, semantic, depth + 1)
                        }
                    }
                    _ => eval_static(init, semantic, depth + 1),
                }
            } else {
                Some(serde_json::Value::Null)
            }
        }
        _ => None,
    }
}

/// Check if an array or object variable is mutated anywhere in the AST.
fn is_object_mutated_in_ast<'a>(
    symbol_id: oxc::semantic::SymbolId,
    semantic: &oxc::semantic::Semantic<'a>,
) -> bool {
    let scoping = semantic.scoping();

    const MUTATING_METHODS: &[&str] = &[
        "push", "pop", "shift", "unshift", "splice",
        "sort", "reverse", "fill", "copyWithin",
        "set", "delete", "clear",
    ];

    for node in semantic.nodes().iter() {
        match node.kind() {
            // symbol.mutatingMethod(...)
            AstKind::CallExpression(call) => {
                if let Expression::StaticMemberExpression(member) = &call.callee {
                    let method_name = member.property.name.as_str();
                    if MUTATING_METHODS.contains(&method_name) {
                        if is_identifier_for_symbol(&member.object, symbol_id, scoping) {
                            return true;
                        }
                    }
                }
            }
            // symbol.prop = value
            AstKind::AssignmentExpression(assign) => {
                if is_assignment_target_our_symbol(&assign.left, symbol_id, scoping) {
                    return true;
                }
            }
            // delete symbol.prop
            AstKind::UnaryExpression(unary) => {
                if unary.operator == UnaryOperator::Delete {
                    if let Expression::StaticMemberExpression(member) = &unary.argument {
                        if is_identifier_for_symbol(&member.object, symbol_id, scoping) {
                            return true;
                        }
                    }
                    if let Expression::ComputedMemberExpression(member) = &unary.argument {
                        if is_identifier_for_symbol(&member.object, symbol_id, scoping) {
                            return true;
                        }
                    }
                }
            }
            _ => {}
        }
    }

    false
}

/// Check if an Expression is an IdentifierReference that resolves to the given symbol.
fn is_identifier_for_symbol(
    expr: &Expression<'_>,
    symbol_id: oxc::semantic::SymbolId,
    scoping: &oxc::semantic::Scoping,
) -> bool {
    if let Expression::Identifier(ident) = expr {
        if let Some(ref_id) = ident.reference_id.get() {
            let reference = scoping.get_reference(ref_id);
            return reference.symbol_id() == Some(symbol_id);
        }
    }
    false
}

/// Check if an AssignmentTarget contains a member expression on our symbol.
fn is_assignment_target_our_symbol(
    target: &AssignmentTarget<'_>,
    symbol_id: oxc::semantic::SymbolId,
    scoping: &oxc::semantic::Scoping,
) -> bool {
    match target {
        AssignmentTarget::StaticMemberExpression(member) => {
            is_identifier_for_symbol(&member.object, symbol_id, scoping)
        }
        AssignmentTarget::ComputedMemberExpression(member) => {
            is_identifier_for_symbol(&member.object, symbol_id, scoping)
        }
        _ => false,
    }
}

/// Extract a property key as a String.
fn property_key_to_string(key: &PropertyKey<'_>) -> Option<String> {
    match key {
        PropertyKey::StaticIdentifier(ident) => {
            Some(ident.name.to_string())
        }
        PropertyKey::StringLiteral(lit) => {
            Some(lit.value.to_string())
        }
        PropertyKey::NumericLiteral(lit) => {
            Some(lit.value.to_string())
        }
        _ => None,
    }
}

/// Convert a f64 number to a serde_json::Value::Number.
fn number_to_json(v: f64) -> Option<serde_json::Value> {
    if v.is_nan() || v.is_infinite() {
        return None;
    }
    if v.fract() == 0.0 && v >= i64::MIN as f64 && v <= i64::MAX as f64 {
        Some(serde_json::Value::Number((v as i64).into()))
    } else {
        serde_json::Number::from_f64(v).map(serde_json::Value::Number)
    }
}

/// Extract ResponseOptions (status + headers) from a serde_json::Value.
fn extract_response_options(val: &serde_json::Value) -> ResponseOptions {
    let mut opts = ResponseOptions {
        status: 200,
        headers: Vec::new(),
    };

    let obj = match val.as_object() {
        Some(o) => o,
        None => return opts,
    };

    if let Some(status) = obj.get("status") {
        if let Some(n) = status.as_u64() {
            if n >= 100 && n <= 599 {
                opts.status = n as u16;
            }
        }
    }

    if let Some(headers) = obj.get("headers") {
        if let Some(h_obj) = headers.as_object() {
            for (key, val) in h_obj {
                if let Some(v_str) = val.as_str() {
                    opts.headers.push((key.clone(), v_str.to_string()));
                }
            }
        }
    }

    opts
}
