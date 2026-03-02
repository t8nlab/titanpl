# Contributing to Titan Planet

First off, thank you for considering contributing to Titan Planet. It's people like you that make Titan such a great tool. 

## 1. Where to Start
- **Bug Reports**: If you find a bug, please create an issue detailing the steps to reproduce it, expected behavior, and actual behavior.
- **Feature Requests**: Have an idea? Open an issue and let's discuss it before you start writing code!
- **Pull Requests**: Pull requests are warmly welcomed. Please make sure to discuss major architectural changes in an issue before implementing them.

## 2. Local Development Setup
Titan is a monorepo leveraging npm workspaces for its packages and Cargo for its Rust core.

### Prerequisites
- Node.js (v18+)
- Rust (latest stable)
- npm

### Installation
1. Fork and clone the repository.
2. Run `npm install` in the root directory to install all package dependencies.
3. The Rust core is located inside the respective `engine-*` packages or main `engine` directory.

## 3. Testing
We use `vitest` for our testing suite and `@tgrv/microgravity` for extension and SDK tests.
- Run `npm test` to execute all package tests.
- Always ensure tests pass before submitting a PR.
- Add tests for new features.

## 4. Submitting a Pull Request
1. Branch from `main`.
2. Commit your changes. Keep commit messages clear and concise.
3. Make sure to update documentation (`README.md`, `CHANGELOG.md`, etc.) if your changes affect user-facing features.
4. Push to your fork and submit a Pull Request!
