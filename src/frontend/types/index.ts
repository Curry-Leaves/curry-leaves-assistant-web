/**
 * Shared renderer types, one file per domain (mirrors src/curry_leaves_assistant's layout and
 * api/'s client modules). `import ... from '../types'` resolves here, so
 * existing call sites keep working unchanged.
 */
export * from './agents';
export * from './artifacts';
export * from './chat';
export * from './dashboard';
export * from './knowledge';
export * from './recordings';
export * from './schedule';
export * from './search';
export * from './settings';
export * from './system';
export * from './tasks';
export * from './templates';
