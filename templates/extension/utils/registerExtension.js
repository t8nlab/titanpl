// utils/registerExtension.js

/**
 * Safely registers an extension in the global t object
 * @param {string} extensionName - Unique name for the extension
 * @param {any} extensionModule - The extension module/object to register
 * @returns {boolean} True if registration was successful
 */
export function registerExtension(extensionName, extensionModule) {
    // Check for global t object
    if (typeof t === 'undefined') {
        console.warn(`[registerExtension] Global 't' object not available. Cannot register: ${extensionName}`);
        return false;
    }

    // Input validation
    if (!extensionName || typeof extensionName !== 'string') {
        console.error('[registerExtension] Invalid extension name provided');
        return false;
    }

    // Check for naming conflicts
    if (t[extensionName]) {
        console.warn(`[registerExtension] '${extensionName}' already exists in global t object, overwriting`);
    }

    try {
        // Register the extension
        t[extensionName] = extensionModule;
        
        console.log(`[registerExtension] Successfully registered '${extensionName}'`);

        return true;
    } catch (error) {
        // Structured error reporting
        console.error(`[registerExtension] Failed to register '${extensionName}':`, {
            error: error.message,
            extensionName,
            moduleType: typeof extensionModule
        });

        return false;
    }
}