// Type definitions for {{name}}
// This file facilitates type inference when this extension is installed in a Titan project.

declare global {
    namespace Titan {
        interface Runtime {
            /**
             * {{name}} Extension
             */
            "{{name}}": {
                /**
                 * Example hello function
                 */
                hello(name: string): string;

                /**
                 * Example calc function (native wrapper)
                 */
                calc(a: number, b: number): number;

                // Add your extension methods here
            }
        }
    }
}

export { };
