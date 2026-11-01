// Runtime secrets/bindings are deliberately absent until their owning stage.
export interface AppEnv {
  APP_ENV: 'dev' | 'test' | 'prod';
}

export function assertEnvironment(env: AppEnv): void {
  if (!['dev', 'test', 'prod'].includes(env.APP_ENV)) {
    throw new Error('Invalid application environment');
  }
}
