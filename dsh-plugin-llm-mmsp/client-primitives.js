/**
 * Build-time shim: the subset of dsh-client-ui-primitives this card uses,
 * re-exported from the harness checkout's SOURCE so the client bundle can
 * inline the very atoms the Models page renders (the installed runtime does
 * not register the primitives package in its web module table, so a runtime
 * `require` would kill module loading — see tsdown.config.mjs, which aliases
 * the package specifier to this file).
 *
 * PORTAL-FREE SUBSET: Modal and Tooltip (react-dom's createPortal) are
 * deliberately absent — the runtime's module table does not seed react-dom
 * for third-party bundles either, so a portal atom would throw at require
 * time. The picker is a native <dialog> and help affordances are title
 * attributes in client.jsx. KEEP IN STEP with client.jsx's import list, and
 * keep this subset free of heavy dependencies (the package root also pulls
 * markdown/shiki/katex, which is why the alias does not point at
 * src/index.ts).
 */
export { Checkbox } from '/Users/kk/Projects/deepseek-harness/packages/client/ui-primitives/src/Checkbox.tsx'
export { Switch } from '/Users/kk/Projects/deepseek-harness/packages/client/ui-primitives/src/Switch.tsx'
export { AnimatedRows } from '/Users/kk/Projects/deepseek-harness/packages/client/ui-primitives/src/AnimatedRows.tsx'
export { useRowDragPreview } from '/Users/kk/Projects/deepseek-harness/packages/client/ui-primitives/src/useRowDragPreview.ts'
export {
  IconChevronDownOutlineRegular, IconChevronRightOutlineRegular, IconDragHandleOutlineRegular,
  IconPlusOutlineRegular, IconTrashOutlineRegular,
} from '/Users/kk/Projects/deepseek-harness/packages/client/ui-primitives/src/icons/index.tsx'
