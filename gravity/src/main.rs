use clap::{Parser, Subcommand};
use std::path::PathBuf;
use std::fs;
use gravity::{RuntimeManager, RequestTask};
use smallvec::smallvec;
use serde_json::json;
mod utils;
use crate::utils::{blue, green, yellow, red, bold, gray};

#[derive(Parser)]
#[command(name = "tgrv")]
#[command(version = "1.0.0")]
#[command(about = "Gravity Standalone Runtime CLI — The engine behind TitanPL", long_about = "Gravity is a high-performance, strictly synchronous V8 runtime with deterministic orchestration (Drift). It executes Titan actions with near-zero overhead.")]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,

    /// JS file to execute as a standalone action
    file: Option<PathBuf>,
}

#[derive(Subcommand)]
enum Commands {
    /// Initialize a new Gravity project with tanfig.json and app.js
    Init,
    /// Install a Titan extension or standard npm package
    Install {
        /// Package name (e.g. @titanpl/core or lodash)
        package: String,
    },
    /// Alias for 'install'
    I {
        /// Package name
        package: String,
    },
    /// Internal: Run the native extension host (do not call directly)
    #[command(hide = true)]
    NativeHost {
        /// Path to the native DLL/SO file
        path: String,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    if let Some(command) = cli.command {
        match command {
            Commands::Init => {
                handle_init().await?;
            }
            Commands::Install { package } | Commands::I { package } => {
                handle_install(Some(package)).await?;
            }
            Commands::NativeHost { path } => {
                gravity::run_native_host(&path).await;
                return Ok(());
            }
        }
    }

    if let Some(file) = cli.file {
        handle_run(file).await?;
    } else {
        println!("{}", blue("Gravity Runtime CLI"));
        println!("Usage: tgrv <file.js> or tgrv [command]");
        println!("Run 'tgrv --help' for all options.");
    }

    std::process::exit(0);
}

async fn handle_init() -> anyhow::Result<()> {
    let name = std::env::current_dir()?
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("gravity-app")
        .to_string();

    let tanfig = json!({
        "name": name,
        "description": "A powerful Gravity project",
        "version": "1.0.0",
        "main": "app.js",
        "direct": true,
        "installed": {
            "@titanpl/core": "latest"
        },
        "extensions": {
            "allowWasm": true,
            "allowNative": [
                "@titanpl/core"
            ]
        },
        "build": {
            "purpose": "production",
            "files": [
                "public",
                "static",
                "db",
                "tanfig.json"
            ]
        }
    });

    fs::write("tanfig.json", serde_json::to_string_pretty(&tanfig)?)?;
    
    // Create basic package.json if it doesn't exist
    if !PathBuf::from("package.json").exists() {
        let pkg_json = json!({
            "name": name,
            "version": "1.0.0",
            "type": "module",
            "dependencies": {}
        });
        fs::write("package.json", serde_json::to_string_pretty(&pkg_json)?)?;
    }

    let app_js = r#"import { log, fetch } from "@titanpl/native";

// Gravity Script
log("Hello from Gravity!");

// You can use drift() for native operations:
// const res = drift(fetch("https://api.example.com"));
// log("Result:", res);
"#;
    fs::write("app.js", app_js)?;

    let jsconfig = json!({
        "compilerOptions": {
            "module": "esnext",
            "target": "esnext",
            "checkJs": false,
            "noImplicitAny": false,
            "allowJs": true,
            "moduleResolution": "node",
            "baseUrl": ".",
            "paths": {
                "@titanpl/native": [
                    "app/t.native"
                ],
                "*": [
                    "./app/*"
                ]
            }
        },
        "include": [
            "app/**/*",
            "titan/**/*",
            "node_modules/**/titan-ext.d.ts"
        ]
    });
    fs::write("jsconfig.json", serde_json::to_string_pretty(&jsconfig)?)?;

    println!("{} Project initialized in {}", green("✔"), blue(&std::env::current_dir()?.display().to_string()));
    println!("{} Created {}, {}, {} and {}", gray("→"), bold("tanfig.json"), bold("app.js"), bold("package.json"), bold("jsconfig.json"));
    
    println!("{} Pre-installing core extensions...", yellow("⚡"));
    let _ = handle_install(Some("@titanpl/core".to_string())).await;
    let _ = handle_install(Some("@titanpl/native".to_string())).await;

    Ok(())
}

async fn handle_install(package_opt: Option<String>) -> anyhow::Result<()> {
    if let Some(package) = package_opt {
        return install_single_package(package).await;
    }

    // Install all from tanfig.json
    if let Ok(content) = fs::read_to_string("tanfig.json") {
        let json: serde_json::Value = serde_json::from_str(&content)?;
        if let Some(installed) = json["installed"].as_object() {
            println!("{} Installing all packages from tanfig.json...", blue("ℹ"));
            for (pkg, _) in installed {
                let _ = install_single_package(pkg.clone()).await;
            }
        }
    } else {
        println!("{} No tanfig.json found. Please specify a package or run 'tgrv init'", red("✖"));
    }
    
    Ok(())
}

async fn install_single_package(package: String) -> anyhow::Result<()> {
    println!("{} Checking package: {}", blue("ℹ"), bold(&package));
    
    let client = reqwest::Client::new();
    let mut is_extension = false;
    let mut _extension_data = None;
    
    let is_types_package = package == "@titanpl/native" || package == "titan-types";

    if !is_types_package {
        let clean_pkg = package.replace("@", "");
        let check_url = format!("https://titanpl.vercel.app/api/extensions/{}", clean_pkg);
        
        if let Ok(ext_resp) = client.get(&check_url).send().await {
            if ext_resp.status().is_success() {
                if let Ok(ext_json) = ext_resp.json::<serde_json::Value>().await {
                    if ext_json.is_object() && !ext_json["error"].is_string() {
                        is_extension = true;
                        _extension_data = Some(ext_json);
                    }
                }
            }
        }
    }

    if package == "@titanpl/core" { is_extension = true; }
    
    let npm_url = format!("https://registry.npmjs.org/{}", package);
    let resp = client.get(npm_url).send().await?;
    
    if !resp.status().is_success() && !is_extension {
        println!("{} {}", red("✖"), red("Package not found on npm"));
        anyhow::bail!("Package not found");
    }
    
    let npm_json: serde_json::Value = if resp.status().is_success() {
        resp.json().await?
    } else {
        json!({})
    };

    let latest_version = npm_json["dist-tags"]["latest"].as_str().unwrap_or("latest");

    if !is_extension && !is_types_package {
        let version_data = &npm_json["versions"][latest_version];
        if version_data["titan"].is_object() || version_data["titan.json"].is_object() {
            is_extension = true;
        } else if let Some(keywords) = npm_json["keywords"].as_array() {
            for kw in keywords {
                if let Some(k) = kw.as_str() {
                    if k == "titan" || k == "titanpl" || k == "t8n" || k == "gravity-extension" {
                        is_extension = true;
                        break;
                    }
                }
            }
        }
    }
    
    if is_extension {
        println!("{} Detected {} extension. Installing to local .ext/...", green("✔"), blue("Titan"));
        let ext_root = std::env::current_dir()?.join(".ext");
        fs::create_dir_all(&ext_root)?;
        
        let tarball_url = if !npm_json.is_null() {
            npm_json["versions"][latest_version]["dist"]["tarball"].as_str()
                .ok_or_else(|| anyhow::anyhow!("Failed to find tarball URL"))?
        } else {
             anyhow::bail!("Failed to fetch npm data for official extension tarball");
        };
            
        let tarball_resp = client.get(tarball_url).send().await?;
        let tarball_bytes = tarball_resp.bytes().await?;
        
        let mut archive = tar::Archive::new(flate2::read::GzDecoder::new(&tarball_bytes[..]));
        let ext_dir = ext_root.join(&package);
        fs::create_dir_all(&ext_dir)?;
        
        for entry in archive.entries()? {
            let mut entry = entry?;
            let path = entry.path()?.to_path_buf();
            let stripped_path = path.strip_prefix("package").unwrap_or(&path);
            let final_path = ext_dir.join(stripped_path);
            if let Some(parent) = final_path.parent() {
                fs::create_dir_all(parent)?;
            }
            entry.unpack(final_path)?;
        }

        update_tanfig_installed(&package, latest_version, true)?;
        println!("{} Extension {} installed to {}", green("✔"), bold(&package), blue(".ext/"));
    } else {
        println!("{} Regular npm package detected. Running {}...", yellow("⚡"), bold("npm install"));
        
        if !PathBuf::from("package.json").exists() {
            let name = std::env::current_dir()?.file_name().and_then(|s| s.to_str()).unwrap_or("gravity-app").to_string();
            let pkg_json = json!({ "name": name, "version": "1.0.0", "type": "module", "dependencies": {} });
            fs::write("package.json", serde_json::to_string_pretty(&pkg_json)?)?;
        }

        let npm_cmd = if cfg!(windows) { "npm.cmd" } else { "npm" };
        let status = std::process::Command::new(npm_cmd).args(["install", &package]).status()?;
            
        if !status.success() {
            anyhow::bail!("npm install failed");
        }
        update_tanfig_installed(&package, latest_version, false)?;
        println!("{} Package {} installed successfully", green("✔"), bold(&package));
    }

    Ok(())
}

fn update_tanfig_installed(package: &str, version: &str, _is_native: bool) -> anyhow::Result<()> {
    if let Ok(content) = fs::read_to_string("tanfig.json") {
        let mut json: serde_json::Value = serde_json::from_str(&content)?;
        if json["installed"].is_null() {
            json["installed"] = json!({});
        }
        json["installed"][package] = json!(version);
        fs::write("tanfig.json", serde_json::to_string_pretty(&json)?)?;
    }
    Ok(())
}

async fn handle_run(file: PathBuf) -> anyhow::Result<()> {
    if !file.exists() {
        anyhow::bail!("File not found: {:?}", file);
    }

    let project_root = std::env::current_dir()?;
    let threads = 1;
    let stack_size = 8 * 1024 * 1024;
    
    let action_name = file.file_stem().unwrap().to_str().unwrap().to_string();
    
    let mut is_direct = false;
    if let Ok(content) = fs::read_to_string("tanfig.json") {
        if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
            is_direct = json["direct"].as_bool().unwrap_or(false);
        }
    }

    println!("{} Starting {} runtime...", blue("⚡"), bold("Gravity"));
    println!("{} Worker Pool: {} threads", gray("→"), blue(&threads.to_string()));
    println!("{} Executing: {}", gray("→"), bold(&file.display().to_string()));

    let temp_out = project_root.join(format!(".gravity_out_{}.js", action_name));
    let esbuild_cmd = if cfg!(windows) { "npx.cmd" } else { "npx" };
    
    let mut code = fs::read_to_string(&file)?;
    let has_imports = code.contains("import ") || code.contains("export ");

    if has_imports {
        let status = std::process::Command::new(esbuild_cmd)
            .args([
                "-y", "esbuild", 
                file.to_str().unwrap(),
                "--bundle",
                "--platform=node",
                "--format=iife",
                "--global-name=__gravity_module",
                &format!("--outfile={}", temp_out.display()),
                "--log-level=error",
                "--external:v8",
            ])
            .status();

        if let Ok(s) = status {
            if s.success() {
                if let Ok(bundled) = fs::read_to_string(&temp_out) {
                    code = bundled;
                    let _ = fs::remove_file(&temp_out);
                }
            } else {
                println!("{} {} esbuild failed to process script.", red("✖"), red("ERROR:"));
            }
        } else {
            println!("{} {} 'npx' not found. ESM imports require Node.js and npx.", red("✖"), red("ERROR:"));
        }
    }

    gravity::extensions::load_project_extensions(project_root.clone());
    let runtime = RuntimeManager::new(project_root.clone(), threads, stack_size);
    runtime.load_action(action_name.clone(), code);

    if !is_direct {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        let exec_res = runtime.execute(
            action_name.clone(),
            "GET".to_string(),
            "/".to_string(),
            None,
            smallvec![],
            smallvec![],
            smallvec![]
        ).await;

        if let Ok((res, _)) = exec_res {
            let is_not_found = res.get("error").and_then(|e| e.as_str()).map(|s| s.contains("not found")).unwrap_or(false);
            if !res.is_null() && res != json!({}) && !is_not_found {
                println!("\n{}", green("--- Action Result ---"));
                println!("{}", serde_json::to_string_pretty(&res)?);
            }
        }
    } else {
        tokio::time::sleep(std::time::Duration::from_millis(150)).await;
    }

    Ok(())
}
