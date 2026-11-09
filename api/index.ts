// The Worker's entry point. It may export only handlers: workerd refuses to start on anything
// else, so the logic and its constants live in app.ts.

import { handle } from './app'

export default { fetch: handle }
