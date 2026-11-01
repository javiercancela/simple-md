export function contentSecurityPolicy(devServer: string): string {
  const script = devServer ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'";
  const connect = devServer
    ? "connect-src 'self' ws://127.0.0.1:* ws://localhost:* http://127.0.0.1:* http://localhost:*"
    : "connect-src 'none'";
  return [
    "default-src 'none'",
    script,
    "style-src 'self' 'unsafe-inline'",
    "img-src data: blob:",
    "font-src 'self'",
    connect,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
