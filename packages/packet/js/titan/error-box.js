/**
 * Error Box Renderer
 * Renders errors in a Next.js-style red terminal box
 */

import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Simple color function using ANSI escape codes
const red = (text) => `\x1b[31m${text}\x1b[0m`;

/**
 * Wraps text to fit within a specified width
 * @param {string} text - Text to wrap
 * @param {number} maxWidth - Maximum width per line
 * @returns {string[]} Array of wrapped lines
 */

function getTitanVersion() {
    try {
        const require = createRequire(import.meta.url);
        const pkgPath = require.resolve("titanpl/package.json");
        return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version;
    } catch (e) {
        try {
            let cur = __dirname;
            for (let i = 0; i < 5; i++) {
                const pkgPath = path.join(cur, "package.json");
                if (fs.existsSync(pkgPath)) {
                    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
                    if (pkg.name === "titanpl") return pkg.version;
                }
                cur = path.join(cur, "..");
            }
        } catch (e2) { }

        try {
            const output = execSync("tit --version", { encoding: "utf-8" }).trim();
            const match = output.match(/v(\d+\.\d+\.\d+)/);
            if (match) return match[1];
        } catch (e3) { }
    }
    return "0.1.0";
}

function wrapText(text, maxWidth) {
    if (!text) return [''];

    const lines = text.split('\n');
    const wrapped = [];

    for (const line of lines) {
        if (line.length <= maxWidth) {
            wrapped.push(line);
            continue;
        }

        // Word wrap logic
        const words = line.split(' ');
        let currentLine = '';

        for (const word of words) {
            const testLine = currentLine ? `${currentLine} ${word}` : word;

            if (testLine.length <= maxWidth) {
                currentLine = testLine;
            } else {
                if (currentLine) {
                    wrapped.push(currentLine);
                }
                // If single word is too long, force split it
                if (word.length > maxWidth) {
                    let remaining = word;
                    while (remaining.length > maxWidth) {
                        wrapped.push(remaining.substring(0, maxWidth));
                        remaining = remaining.substring(maxWidth);
                    }
                    currentLine = remaining;
                } else {
                    currentLine = word;
                }
            }
        }

        if (currentLine) {
            wrapped.push(currentLine);
        }
    }

    return wrapped.length > 0 ? wrapped : [''];
}

/**
 * Pads text to fit within box width
 * @param {string} text - Text to pad
 * @param {number} width - Target width
 * @returns {string} Padded text
 */
function padLine(text, width) {
    const padding = width - text.length;
    return text + ' '.repeat(Math.max(0, padding));
}

/**
 * Renders an error in a Next.js-style red box
 * @param {Object} errorInfo - Error information
 * @param {string} errorInfo.title - Error title (e.g., "Build Error")
 * @param {string} errorInfo.file - File path where error occurred
 * @param {string} errorInfo.message - Error message
 * @param {string} [errorInfo.location] - Error location (e.g., "at hello.js:3:1")
 * @param {number} [errorInfo.line] - Line number
 * @param {number} [errorInfo.column] - Column number
 * @param {string} [errorInfo.codeFrame] - Code frame showing error context
 * @param {string} [errorInfo.suggestion] - Recommended fix
 */
/**
 * Renders an error in a Next.js-style red box
 * @param {Object} errorInfo - Error information
 * @param {string} errorInfo.title - Error title (e.g., "Build Error")
 * @param {string} errorInfo.file - File path where error occurred
 * @param {string} errorInfo.message - Error message
 * @param {string} [errorInfo.location] - Error location (e.g., "at hello.js:3:1")
 * @param {number} [errorInfo.line] - Line number
 * @param {number} [errorInfo.column] - Column number
 * @param {string} [errorInfo.codeFrame] - Code frame showing error context
 * @param {string} [errorInfo.suggestion] - Recommended fix
 */
export function renderErrorBox(errorInfo) {
    const boxWidth = 72;
    const contentWidth = boxWidth - 4; // Account for "│ " and " │"

    const lines = [];

    // Add title
    if (errorInfo.title) {
        lines.push(bold(errorInfo.title));
    }

    // Add file path
    if (errorInfo.file) {
        lines.push(errorInfo.file);
    }

    // Add message
    if (errorInfo.message) {
        lines.push('');
        lines.push(...wrapText(errorInfo.message, contentWidth));
    }

    // Add location
    if (errorInfo.location) {
        lines.push(gray(errorInfo.location));
    } else if (errorInfo.file && errorInfo.line !== undefined) {
        const loc = `at ${errorInfo.file}:${errorInfo.line}${errorInfo.column !== undefined ? `:${errorInfo.column}` : ''}`;
        lines.push(gray(loc));
    }

    // Add code frame if available
    if (errorInfo.codeFrame) {
        lines.push(''); // Empty line for separation
        const frameLines = errorInfo.codeFrame.split('\n');
        for (const frameLine of frameLines) {
            lines.push(frameLine);
        }
    }

    // Add suggestion if available
    if (errorInfo.suggestion) {
        lines.push(''); // Empty line for separation
        lines.push(...wrapText('Recommended fix: ' + errorInfo.suggestion, contentWidth));
    }

    // Add Footer with Branding
    lines.push('');
    const version = getTitanVersion()
    lines.push(gray(`⏣ Titan Planet      ${version}`));

    // Build the box
    const topBorder = '┌' + '─'.repeat(boxWidth - 2) + '┐';
    const bottomBorder = '└' + '─'.repeat(boxWidth - 2) + '┘';


    const boxLines = [
        red(topBorder),
        ...lines.map(line => {
            // Strip ANSI codes for padding calculation if any were added
            const plainLine = line.replace(/\x1b\[\d+m/g, '');
            const padding = ' '.repeat(Math.max(0, contentWidth - plainLine.length));
            return red('│ ') + line + padding + red(' │');
        }),
        red(bottomBorder)
    ];

    return boxLines.join('\n');
}

// Internal formatting helpers
function gray(t) { return `\x1b[90m${t}\x1b[0m`; }
function bold(t) { return `\x1b[1m${t}\x1b[0m`; }

/**
 * Parses esbuild error and extracts relevant information
 * @param {Object} error - esbuild error object
 * @returns {Object} Parsed error information
 */
export function parseEsbuildError(error) {
    const errorInfo = {
        title: 'Build Error',
        file: error.location?.file || 'unknown',
        message: error.text || error.message || 'Unknown error',
        line: error.location?.line,
        column: error.location?.column,
        location: null,
        codeFrame: null,
        suggestion: error.notes?.[0]?.text || null
    };

    // Format location
    if (error.location) {
        const { file, line, column } = error.location;
        errorInfo.location = `at ${file}:${line}:${column}`;

        // Format code frame if lineText is available
        if (error.location.lineText) {
            const lineText = error.location.lineText;
            // Ensure column is at least 1 to prevent negative values
            const col = Math.max(0, (column || 1) - 1);
            const pointer = ' '.repeat(col) + '^';
            errorInfo.codeFrame = `${line} | ${lineText}\n${' '.repeat(String(line).length)} | ${pointer}`;
        }
    }

    return errorInfo;
}

/**
 * Parses Node.js syntax error and extracts relevant information
 * @param {Error} error - Node.js error object
 * @param {string} [file] - File path (if known)
 * @returns {Object} Parsed error information
 */
export function parseNodeError(error, file = null) {
    const errorInfo = {
        title: 'Syntax Error',
        file: file || 'unknown',
        message: error.message || 'Unknown error',
        location: null,
        suggestion: null
    };

    // Try to extract line and column from error message
    const locationMatch = error.message.match(/\((\d+):(\d+)\)/) ||
        error.stack?.match(/:(\d+):(\d+)/);

    if (locationMatch) {
        const line = parseInt(locationMatch[1]);
        const column = parseInt(locationMatch[2]);
        errorInfo.line = line;
        errorInfo.column = column;
        errorInfo.location = `at ${errorInfo.file}:${line}:${column}`;
    }

    // Extract suggestion from error message if available
    if (error.message.includes('expected')) {
        errorInfo.suggestion = 'Check for missing or misplaced syntax elements';
    } else if (error.message.includes('Unexpected token')) {
        errorInfo.suggestion = 'Remove or fix the unexpected token';
    }

    return errorInfo;
}
