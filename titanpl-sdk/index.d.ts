export { };

declare global {
    /**
     * Titan Runtime Global Object
     */
    const t: Titan.Runtime;
    /**
     * Titan Runtime Global Object 
     */
    const Titan: Titan.Runtime;
}

export namespace Titan {
    interface Runtime {
        /**
         * Log messages to the Titan console
         */
        log: LogInterface;

        /**
         * Read file content
         */
        read(path: string): string;

        /**
         * Fetch API wrapper
         */
        fetch(url: string, options?: any): Promise<any>;

        /**
         * Database operations
         */
        db: {
            query(sql: string, params?: any[]): Promise<any>;
        };

        /**
         * Titan Extensions
         */
        [key: string]: any;
    }

    interface LogInterface {
        (...args: any[]): void;
        info(...args: any[]): void;
        warn(...args: any[]): void;
        error(...args: any[]): void;
    }
}
