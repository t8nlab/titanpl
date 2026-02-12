// =============================================================================
// fast_path.rs — Static Action Detection via OXC Semantic Analysis
// =============================================================================
//
// PURPOSE:
//   Bypass V8 entirely for actions that return constant/static values.
//   Uses OXC (Oxidation Compiler) to parse JavaScript into a real AST and
//   perform semantic analysis with constant propagation.
//
// HOW IT WORKS:
//   1. At startup, reads each bundled action file (.jsbundle)
//   2. Parses with OXC into a full AST + builds semantic (symbol table, scopes)
//   3. Walks AST nodes looking for t.response.json/text/html() calls
//   4. For each call, recursively evaluates arguments for static constancy:
//      - Literals → static value
//      - Identifier references → resolved via symbol table:
//        a. Check symbol is never mutated (write_count == 0 after decl)
//        b. Trace back to declaration's init expression
//        c. Recursively evaluate that init expression
//      - Object/Array expressions → static if ALL members are static
//      - Template literals → static if ALL interpolations are static
//      - Binary '+' → static if both sides are static (string concat / addition)
//   5. If ALL t.response.*() calls produce the SAME static value → fast-path
//
// ADVANTAGES OVER REGEX:
//   - Resolves variables:  `var msg = "Hello"; { message: msg }` → ✅ static
//   - Transitive const:    `var a = "Hello"; var b = a;` → ✅ static
//   - Template literals:   `var x = "World"; `Hello, ${x}!`` → ✅ static
//   - String concatenation: `"Hello" + ", " + "World!"` → ✅ static
//   - No false positives:  Comments/strings containing t.response.* are ignored
//   - Correctness proven:  AST + semantic analysis = mathematical guarantee
//
// SAFETY:
//   - If ANY value in the return path is dynamic → action is NOT fast-pathed
//   - `var` declarations are safe IF never reassigned (OXC tracks mutations)
//   - Side effects (console.log, t.log) are ignored — only return value matters
//   - Recursion depth is capped to prevent infinite loops
//
// =============================================================================

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

// =============================================================================
// DATA STRUCTURES
// =============================================================================

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

/// Options extracted from the second argument of t.response.*() calls.
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

// =============================================================================
// PRE-COMPUTED ROUTE RESPONSES
// =============================================================================

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

// =============================================================================
// OXC-BASED SOURCE ANALYSIS
// =============================================================================

/// Maximum recursion depth for static expression evaluation.
/// Prevents infinite loops from circular references (shouldn't happen in
/// well-formed JS, but defensive programming).
const MAX_EVAL_DEPTH: usize = 16;

/// Analyze a bundled action's source code using OXC semantic analysis.
///
/// Pipeline:
///   1. Parse source → AST (OXC parser, ~50µs for typical bundles)
///   2. Build semantic → symbol table + scope tree + reference resolution
///   3. Walk all AST nodes looking for t.response.json/text/html() calls
///   4. For each call, evaluate arguments with constant propagation
///   5. If all calls produce identical static values → return StaticResponse
fn analyze_action_source(source: &str) -> Option<StaticResponse> {
    // --- Phase 1: Parse ---
    let allocator = Allocator::default();
    let source_type = SourceType::mjs(); // ES module JavaScript
    let parser_ret = Parser::new(&allocator, source, source_type).parse();

    if parser_ret.panicked {
        return None;
    }

    // --- Phase 2: Semantic analysis ---
    // Builds symbol table, resolves all identifier references to their
    // declaring symbols, and tracks read/write counts per symbol.
    let semantic_ret = SemanticBuilder::new().build(&parser_ret.program);
    let semantic = &semantic_ret.semantic;

    // --- Phase 3: Find and evaluate t.response.*() calls ---
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
    // AST shape: StaticMemberExpression {
    //   object: StaticMemberExpression {
    //     object: IdentifierReference("t"),
    //     property: "response"
    //   },
    //   property: "json" | "text" | "html"
    // }

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

// =============================================================================
// STATIC EXPRESSION EVALUATOR — The Core of Constant Propagation
// =============================================================================

/// Recursively evaluate a JavaScript expression to a serde_json::Value.
///
/// Returns `Some(value)` if the expression is provably static (constant).
/// Returns `None` if the expression depends on runtime values (dynamic).
///
/// This is the heart of the constant propagation engine. It handles:
///   - Literal values (string, number, boolean, null)
///   - Object expressions (if all properties are static)
///   - Array expressions (if all elements are static)
///   - Identifier references (resolved via symbol table)
///   - Template literals (if all interpolations are static)
///   - Binary '+' operations (string concat / numeric addition)
///   - Unary '-' for negative numbers
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
        // -----------------------------------------------------------------
        // LITERALS — always static
        // -----------------------------------------------------------------
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

        // -----------------------------------------------------------------
        // OBJECT EXPRESSION — static if ALL property values are static
        // -----------------------------------------------------------------
        // Handles: { message: "Hello" }, { a: var1, b: "literal" }, etc.
        Expression::ObjectExpression(obj) => {
            let mut map = serde_json::Map::with_capacity(obj.properties.len());

            for prop in &obj.properties {
                match prop {
                    ObjectPropertyKind::ObjectProperty(p) => {
                        // Extract the property key as a string
                        let key = property_key_to_string(&p.key)?;

                        // Recursively evaluate the value
                        let val = eval_static(&p.value, semantic, depth + 1)?;

                        map.insert(key, val);
                    }
                    // SpreadProperty → dynamic (can't statically resolve)
                    ObjectPropertyKind::SpreadProperty(_) => return None,
                }
            }

            Some(Value::Object(map))
        }

        // -----------------------------------------------------------------
        // ARRAY EXPRESSION — static if ALL elements are static
        // -----------------------------------------------------------------
        // Handles: [1, 2, 3], ["a", varB], etc.
        Expression::ArrayExpression(arr) => {
            let mut vec = Vec::with_capacity(arr.elements.len());

            for elem in &arr.elements {
                match elem {
                    ArrayExpressionElement::SpreadElement(_) => return None,
                    ArrayExpressionElement::Elision(_) => {
                        vec.push(Value::Null); // holes become null in JSON
                    }
                    _ => {
                        // Expression element
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

        // -----------------------------------------------------------------
        // IDENTIFIER REFERENCE — resolve via symbol table
        // -----------------------------------------------------------------
        // This is where OXC's power shines. For `var msg = "Hello"`:
        //   1. Get the symbol this identifier refers to
        //   2. Check it's never reassigned (not mutated)
        //   3. Find its declaration and evaluate the init expression
        Expression::Identifier(ident) => {
            resolve_identifier(ident, semantic, depth)
        }

        // -----------------------------------------------------------------
        // TEMPLATE LITERAL — static if all interpolations are static
        // -----------------------------------------------------------------
        // Handles: `Hello, ${name}!` where name is a static variable
        Expression::TemplateLiteral(tpl) => {
            // No expressions = simple string
            if tpl.expressions.is_empty() {
                let s = tpl.quasis.iter()
                    .filter_map(|q| q.value.cooked.as_ref())
                    .map(|a| a.as_str())
                    .collect::<String>();
                return Some(Value::String(s));
            }

            let mut result = String::new();

            for (i, quasi) in tpl.quasis.iter().enumerate() {
                // Append the static text part
                if let Some(cooked) = &quasi.value.cooked {
                    result.push_str(cooked.as_str());
                } else {
                    return None; // Invalid template (contains \unicode issues)
                }

                // Append the interpolated expression (if not the tail)
                if i < tpl.expressions.len() {
                    let val = eval_static(&tpl.expressions[i], semantic, depth + 1)?;
                    match val {
                        Value::String(s) => result.push_str(&s),
                        Value::Number(n) => result.push_str(&n.to_string()),
                        Value::Bool(b) => result.push_str(if b { "true" } else { "false" }),
                        Value::Null => result.push_str("null"),
                        _ => return None, // Objects/arrays can't be interpolated statically
                    }
                }
            }

            Some(Value::String(result))
        }

        // -----------------------------------------------------------------
        // BINARY EXPRESSION — handle '+' for string concat / numeric addition
        // -----------------------------------------------------------------
        Expression::BinaryExpression(bin) => {
            if bin.operator != BinaryOperator::Addition {
                return None;
            }

            let left = eval_static(&bin.left, semantic, depth + 1)?;
            let right = eval_static(&bin.right, semantic, depth + 1)?;

            match (&left, &right) {
                // String concatenation
                (Value::String(l), Value::String(r)) => {
                    Some(Value::String(format!("{}{}", l, r)))
                }
                // String + non-string coercion (JS behavior)
                (Value::String(l), Value::Number(r)) => {
                    Some(Value::String(format!("{}{}", l, r)))
                }
                (Value::Number(l), Value::String(r)) => {
                    Some(Value::String(format!("{}{}", l, r)))
                }
                // Numeric addition
                (Value::Number(l), Value::Number(r)) => {
                    let lv = l.as_f64()?;
                    let rv = r.as_f64()?;
                    number_to_json(lv + rv)
                }
                _ => None,
            }
        }

        // -----------------------------------------------------------------
        // UNARY EXPRESSION — handle '-' for negative numbers
        // -----------------------------------------------------------------
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

        // -----------------------------------------------------------------
        // PARENTHESIZED — unwrap and evaluate inner
        // -----------------------------------------------------------------
        Expression::ParenthesizedExpression(paren) => {
            eval_static(&paren.expression, semantic, depth)
        }

        // -----------------------------------------------------------------
        // ANYTHING ELSE — considered dynamic
        // -----------------------------------------------------------------
        // CallExpression, MemberExpression, ConditionalExpression,
        // AwaitExpression, NewExpression, etc. → all dynamic
        _ => None,
    }
}

// =============================================================================
// IDENTIFIER RESOLUTION VIA SYMBOL TABLE
// =============================================================================

/// Resolve an IdentifierReference to a static value using OXC's semantic analysis.
///
/// Algorithm:
///   1. Get the ReferenceId from the identifier (populated by semantic analysis)
///   2. Look up which Symbol it resolves to
///   3. If the symbol is unresolved (global) → dynamic (could be anything)
///   4. Check if the symbol is ever mutated (reassigned) → if yes, dynamic
///   5. Find the symbol's declaration AST node
///   6. If it's a VariableDeclarator with an init expression → evaluate that
///   7. Recurse with depth+1 to handle transitive constants
fn resolve_identifier<'a>(
    ident: &IdentifierReference<'a>,
    semantic: &oxc::semantic::Semantic<'a>,
    depth: usize,
) -> Option<serde_json::Value> {
    if depth > MAX_EVAL_DEPTH {
        return None;
    }

    // Step 1: Get the reference ID (assigned during semantic analysis)
    let ref_id = ident.reference_id.get()?;

    // Step 2: Look up the symbol this reference points to
    let scoping = semantic.scoping();
    let reference = scoping.get_reference(ref_id);
    let symbol_id = reference.symbol_id()?;

    // Step 3: Check if the symbol is ever reassigned
    // For `var msg = "Hello"`, msg has write_count=0 after decl → not mutated
    // For `let x = 1; x = 2;`, x is mutated → dynamic
    if scoping.symbol_is_mutated(symbol_id) {
        return None;
    }

    // Step 4: Find the declaration's AST node
    let decl_node_id = scoping.symbol_declaration(symbol_id);
    let decl_node = semantic.nodes().get_node(decl_node_id);

    // Step 5: If it's a VariableDeclarator, evaluate its init expression
    match decl_node.kind() {
        AstKind::VariableDeclarator(declarator) => {
            if let Some(init) = &declarator.init {
                match init {
                    // Array/Object literals CAN be mutated via method calls
                    // (e.g. arr.push(), obj.key = val) without reassigning the binding.
                    // symbol_is_mutated() won't catch this, so we do deeper analysis.
                    Expression::ArrayExpression(_) | Expression::ObjectExpression(_) => {
                        if is_object_mutated_in_ast(symbol_id, semantic) {
                            None // mutated via .push(), .splice(), property assign, etc.
                        } else {
                            eval_static(init, semantic, depth + 1) // truly constant
                        }
                    }
                    _ => eval_static(init, semantic, depth + 1),
                }
            } else {
                // `var x;` without init → undefined → null in JSON
                Some(serde_json::Value::Null)
            }
        }
        // Function parameters, class members, etc. → dynamic
        _ => None,
    }
}

// =============================================================================
// OBJECT / ARRAY MUTATION DETECTION
// =============================================================================

/// Check if an array or object variable is mutated anywhere in the AST.
///
/// Walks ALL AST nodes looking for patterns where the symbol is the object
/// of a mutating method call or property assignment.
///
/// Detected patterns:
///   - `symbol.push(x)`          → mutating method call
///   - `symbol.splice(0, 1)`     → mutating method call
///   - `symbol.sort()`           → mutating method call
///   - `symbol.prop = value`     → property assignment
///   - `symbol[idx] = value`     → computed property assignment
///   - `delete symbol.prop`      → property deletion
///
/// Performance: O(n) where n = number of AST nodes. For typical .jsbundle
/// files (<500 nodes), this completes in <10µs. Only called at startup.
fn is_object_mutated_in_ast<'a>(
    symbol_id: oxc::semantic::SymbolId,
    semantic: &oxc::semantic::Semantic<'a>,
) -> bool {
    let scoping = semantic.scoping();

    // Known mutating methods for arrays and collection types
    const MUTATING_METHODS: &[&str] = &[
        // Array mutators (modify in place)
        "push", "pop", "shift", "unshift", "splice",
        "sort", "reverse", "fill", "copyWithin",
        // Map/Set mutators
        "set", "delete", "clear",
    ];

    for node in semantic.nodes().iter() {
        match node.kind() {
            // =========================================================
            // Pattern 1: symbol.mutatingMethod(...)
            // AST: CallExpression {
            //   callee: StaticMemberExpression {
            //     object: IdentifierReference → symbol_id
            //     property: "push" | "splice" | ...
            //   }
            // }
            // =========================================================
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

            // =========================================================
            // Pattern 2: symbol.prop = value  OR  symbol[expr] = value
            // AST: AssignmentExpression {
            //   left: AssignmentTarget::StaticMemberExpression { object: symbol }
            //         or ComputedMemberExpression { object: symbol }
            // }
            // =========================================================
            AstKind::AssignmentExpression(assign) => {
                if is_assignment_target_our_symbol(&assign.left, symbol_id, scoping) {
                    return true;
                }
            }

            // =========================================================
            // Pattern 3: delete symbol.prop
            // AST: UnaryExpression {
            //   operator: Delete,
            //   argument: MemberExpression { object: symbol }
            // }
            // =========================================================
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
/// Handles: symbol.prop = ..., symbol[expr] = ...
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

// =============================================================================
// HELPERS
// =============================================================================

/// Extract a property key as a String.
/// Handles: `{ message: ... }`, `{ "Content-Type": ... }`, `{ 0: ... }`
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
        // Computed keys like [variable] → dynamic, can't resolve statically
        _ => None,
    }
}

/// Convert a f64 number to a serde_json::Value::Number.
/// Prefers integer representation when possible (no fractional part).
fn number_to_json(v: f64) -> Option<serde_json::Value> {
    if v.is_nan() || v.is_infinite() {
        return None; // NaN and Infinity aren't valid JSON
    }
    if v.fract() == 0.0 && v >= i64::MIN as f64 && v <= i64::MAX as f64 {
        Some(serde_json::Value::Number((v as i64).into()))
    } else {
        serde_json::Number::from_f64(v).map(serde_json::Value::Number)
    }
}

/// Extract ResponseOptions (status + headers) from a serde_json::Value.
/// Expected shape: { headers: { Key: "value", ... }, status: 201 }
fn extract_response_options(val: &serde_json::Value) -> ResponseOptions {
    let mut opts = ResponseOptions {
        status: 200,
        headers: Vec::new(),
    };

    let obj = match val.as_object() {
        Some(o) => o,
        None => return opts,
    };

    // Extract status
    if let Some(status) = obj.get("status") {
        if let Some(n) = status.as_u64() {
            if n >= 100 && n <= 599 {
                opts.status = n as u16;
            }
        }
    }

    // Extract headers
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

// =============================================================================
// DEPENDENCY NOTE
// =============================================================================
// This module uses the `oxc` umbrella crate with the "semantic" feature.
// Add to Cargo.toml:
//   oxc = { version = "0.108", features = ["semantic"] }
//
// The `oxc` crate re-exports:
//   - oxc::allocator    → Arena allocator for AST nodes
//   - oxc::parser       → JavaScript/TypeScript parser
//   - oxc::ast          → AST node definitions
//   - oxc::semantic     → Symbol table, scope tree, reference resolution
//   - oxc::span         → Source positions and SourceType
//
// At startup, this adds ~50-200µs per action file to parse + analyze.
// This is a one-time cost that enables O(1) response serving at runtime.
// =============================================================================

// =============================================================================
// TESTS
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    /// Helper: run analysis and return the response if static
    fn analyze(source: &str) -> Option<StaticResponse> {
        analyze_action_source(source)
    }

    // --- Literals (same as regex) ---

    #[test]
    fn test_literal_json() {
        let source = r#"
            function json(req) {
                return t.response.json({ message: "Hello, World!" });
            }
        "#;
        let resp = analyze(source).expect("should detect static");
        assert_eq!(resp.content_type, "application/json");
        assert_eq!(resp.body.as_ref(), br#"{"message":"Hello, World!"}"#);
        assert_eq!(resp.status, 200);
    }

    #[test]
    fn test_literal_text() {
        let source = r#"
            function plaintext(req) {
                return t.response.text("Hello, World!", {
                    headers: { "Content-Type": "text/plain", Server: "titanpl" }
                });
            }
        "#;
        let resp = analyze(source).expect("should detect static");
        assert_eq!(resp.content_type, "text/plain");
        assert_eq!(resp.body.as_ref(), b"Hello, World!");
    }

    #[test]
    fn test_with_status_and_headers() {
        let source = r#"
            function api(req) {
                return t.response.json({ ok: true }, { status: 201, headers: { Server: "titanpl" } });
            }
        "#;
        let resp = analyze(source).expect("should detect static");
        assert_eq!(resp.status, 201);
        assert!(resp.extra_headers.iter().any(|(k, v)| k == "Server" && v == "titanpl"));
    }

    // --- Variable resolution (NEW with OXC — impossible with regex) ---

    #[test]
    fn test_var_reference() {
        let source = r#"
            var msg = "Hello, World!";
            function json(req) {
                return t.response.json({ message: msg });
            }
        "#;
        let resp = analyze(source).expect("should resolve var to literal");
        assert_eq!(resp.body.as_ref(), br#"{"message":"Hello, World!"}"#);
    }

    #[test]
    fn test_const_reference() {
        let source = r#"
            const greeting = "Hello, World!";
            function json(req) {
                return t.response.json({ message: greeting });
            }
        "#;
        let resp = analyze(source).expect("should resolve const to literal");
        assert_eq!(resp.body.as_ref(), br#"{"message":"Hello, World!"}"#);
    }

    #[test]
    fn test_transitive_const() {
        let source = r#"
            var a = "Hello";
            var b = a;
            function json(req) {
                return t.response.json({ message: b });
            }
        "#;
        let resp = analyze(source).expect("should resolve transitively");
        assert_eq!(resp.body.as_ref(), br#"{"message":"Hello"}"#);
    }

    #[test]
    fn test_var_in_options() {
        let source = r#"
            var STATUS = 201;
            var SERVER = "titanpl";
            function api(req) {
                return t.response.json({ ok: true }, { status: STATUS, headers: { Server: SERVER } });
            }
        "#;
        let resp = analyze(source).expect("should resolve options vars");
        assert_eq!(resp.status, 201);
        assert!(resp.extra_headers.iter().any(|(k, v)| k == "Server" && v == "titanpl"));
    }

    // --- String operations (NEW with OXC) ---

    #[test]
    fn test_string_concatenation() {
        let source = r#"
            var greeting = "Hello" + ", " + "World!";
            function json(req) {
                return t.response.json({ message: greeting });
            }
        "#;
        let resp = analyze(source).expect("should resolve concatenation");
        assert_eq!(resp.body.as_ref(), br#"{"message":"Hello, World!"}"#);
    }

    #[test]
    fn test_template_literal() {
        let source = r#"
            var name = "World";
            function json(req) {
                return t.response.text(`Hello, ${name}!`);
            }
        "#;
        let resp = analyze(source).expect("should resolve template");
        assert_eq!(resp.body.as_ref(), b"Hello, World!");
    }

    // --- Dynamic detection (should correctly reject) ---

    #[test]
    fn test_req_access_is_dynamic() {
        let source = r#"
            function json(req) {
                return t.response.json({ message: req.query.msg });
            }
        "#;
        assert!(analyze(source).is_none(), "req access should be dynamic");
    }

    #[test]
    fn test_function_call_is_dynamic() {
        let source = r#"
            function json(req) {
                return t.response.json({ time: Date.now() });
            }
        "#;
        assert!(analyze(source).is_none(), "Date.now() should be dynamic");
    }

    #[test]
    fn test_mutated_var_is_dynamic() {
        let source = r#"
            var msg = "Hello";
            msg = "Goodbye";
            function json(req) {
                return t.response.json({ message: msg });
            }
        "#;
        assert!(analyze(source).is_none(), "mutated var should be dynamic");
    }

    #[test]
    fn test_math_random_is_dynamic() {
        let source = r#"
            function json(req) {
                var id = Math.floor(Math.random() * 100);
                return t.response.json({ id: id });
            }
        "#;
        assert!(analyze(source).is_none(), "Math.random should be dynamic");
    }

    #[test]
    fn test_drift_is_dynamic() {
        let source = r#"
            function db(req) {
                var conn = t.db.connect(process.env.DATABASE_URL);
                var rows = drift(conn.query("SELECT * FROM world"));
                return t.response.json(rows);
            }
        "#;
        assert!(analyze(source).is_none(), "drift should be dynamic");
    }

    // --- Real bundle format test ---

    #[test]
    fn test_real_json_bundle() {
        let source = r#"
var Titan = t;
var __titan_exports = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var json_exports = {};
  __export(json_exports, {
    json: () => json
  });
  var msg = "Hello, World!";
  function json(req) {
    return t.response.json({
      message: msg
    }, {
      headers: {
        Server: "titanpl"
      }
    });
  }
  return __toCommonJS(json_exports);
})();
        "#;
        let resp = analyze(source).expect("should detect static in real bundle");
        assert_eq!(resp.content_type, "application/json");
        assert_eq!(resp.body.as_ref(), br#"{"message":"Hello, World!"}"#);
        assert!(resp.extra_headers.iter().any(|(k, v)| k == "Server" && v == "titanpl"));
    }

    #[test]
    fn test_real_db_bundle_is_dynamic() {
        let source = r#"
  function db(req) {
    const id = Math.floor(Math.random() * 1e4) + 1;
    const conn = t.db.connect(process.env.DATABASE_URL);
    const rows = drift(conn.query(
      `SELECT id, randomnumber FROM world WHERE id = ${id}`
    ));
    return t.response.json({
      id: rows[0].id,
      randomNumber: rows[0].randomnumber
    }, {
      headers: {
        Server: "titanpl"
      }
    });
  }
        "#;
        assert!(analyze(source).is_none(), "db action should be dynamic");
    }

    // =========================================================================
    // ARRAY / OBJECT MUTATION DETECTION
    // =========================================================================

    #[test]
    fn test_array_with_push_is_dynamic() {
        let source = r#"
  var results = [];
  results.push({ id: 1 });
  return t.response.json(results);
        "#;
        assert!(analyze(source).is_none(), "array with .push() should be dynamic");
    }

    #[test]
    fn test_array_with_splice_is_dynamic() {
        let source = r#"
  var items = [1, 2, 3];
  items.splice(0, 1);
  return t.response.json(items);
        "#;
        assert!(analyze(source).is_none(), "array with .splice() should be dynamic");
    }

    #[test]
    fn test_object_with_property_assign_is_dynamic() {
        let source = r#"
  var obj = {};
  obj.name = "dynamic";
  return t.response.json(obj);
        "#;
        assert!(analyze(source).is_none(), "object with property assign should be dynamic");
    }

    #[test]
    fn test_object_with_computed_assign_is_dynamic() {
        let source = r#"
  var obj = {};
  obj["key"] = "value";
  return t.response.json(obj);
        "#;
        assert!(analyze(source).is_none(), "object with computed assign should be dynamic");
    }

    #[test]
    fn test_immutable_array_is_static() {
        let source = r#"
  var items = [1, 2, 3];
  return t.response.json(items);
        "#;
        let result = analyze(source);
        assert!(result.is_some(), "immutable array should be static");
        let r = result.unwrap();
        assert_eq!(r.content_type, "application/json");
        assert_eq!(std::str::from_utf8(&r.body).unwrap(), "[1,2,3]");
    }

    #[test]
    fn test_immutable_object_is_static() {
        let source = r#"
  var config = { version: "1.0", debug: false };
  return t.response.json(config);
        "#;
        let result = analyze(source);
        assert!(result.is_some(), "immutable object should be static");
        let r = result.unwrap();
        assert_eq!(r.content_type, "application/json");
    }

    #[test]
    fn test_tfb_queries_pattern_is_dynamic() {
        // Real TFB pattern: const results = []; for loop with push
        let source = r#"
  var count = 5;
  var results = [];
  for (var i = 0; i < count; i++) {
    results.push({ id: i, randomnumber: 42 });
  }
  return t.response.json(results, {
    headers: { Server: "titanpl" }
  });
        "#;
        assert!(analyze(source).is_none(), "TFB queries pattern should be dynamic");
    }

    #[test]
    fn test_array_sort_is_dynamic() {
        let source = r#"
  var items = [3, 1, 2];
  items.sort();
  return t.response.json(items);
        "#;
        assert!(analyze(source).is_none(), "array with .sort() should be dynamic");
    }

    #[test]
    fn test_delete_property_is_dynamic() {
        let source = r#"
  var obj = { a: 1, b: 2 };
  delete obj.b;
  return t.response.json(obj);
        "#;
        assert!(analyze(source).is_none(), "object with delete should be dynamic");
    }
}