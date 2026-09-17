export interface ControlApiConfig {
  readonly port: number;
  readonly host: string;
}

export function loadControlApiConfig(): ControlApiConfig {
  return {
    port: parseInt(process.env['CONTROL_API_PORT'] ?? '8000', 10),
    host: process.env['CONTROL_API_HOST'] ?? '0.0.0.0'
  };
}
