export interface RouteBuilder {
    reply(value: any): void;
    action(name: string): void;
}

export interface TitanRoute {
    get(route: string): RouteBuilder;
    post(route: string): RouteBuilder;
    put(route: string): RouteBuilder;
    delete(route: string): RouteBuilder;
    log(module: string, msg: string): void;
    start(port?: number, msg?: string, threads?: number, stack_mb?: number): void;
}

declare const t: TitanRoute;
export default t;
