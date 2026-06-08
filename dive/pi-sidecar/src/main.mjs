#!/usr/bin/env node
// Executable entry for the DIVE Pi sidecar.
// Kept separate from index.mjs (which only exports, so tests can import it
// without starting the protocol, and so the bundle has no `import.meta`).
import { startProtocol } from "./index.mjs";

startProtocol();
