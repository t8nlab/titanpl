// -- Module Definitions (for imports from "titan") --

export interface RouteHandler {
    reply(value: any): void;
    action(name: string): void;
}

export interface TitanBuilder {
    get(route: string): RouteHandler;
    post(route: string): RouteHandler;
    log(module: string, msg: string): void;
    start(port?: number, msg?: string, threads?: number): Promise<void>;
}

declare const builder: TitanBuilder;
export const Titan: TitanBuilder;
export default builder;