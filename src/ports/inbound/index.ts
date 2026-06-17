export interface ProxyGateway {
  handle(request: Request): Promise<Response>;
}
