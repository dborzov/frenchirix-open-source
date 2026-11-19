// Types `env` and `exports` from 'cloudflare:test' and 'cloudflare:workers' with this Worker's bindings.
import type { Env as AppBindings } from './env';

declare global {
  namespace Cloudflare {
    interface GlobalProps {
      mainModule: typeof import('./index');
    }
    interface Env extends AppBindings {}
  }
}
