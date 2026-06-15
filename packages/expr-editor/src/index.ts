// @wildwinter/expr-editor — a framework-neutral visual editor for @wildwinter/expr
// expressions. The pure model (AST mutation, the AND/OR tree, operator metadata,
// the property catalogue, validation) is exported here; the DOM mount API
// (mountExpressionEditor) is added by ./mount once the UI layer lands.

export * from "./ast.js";
export * from "./tree.js";
export * from "./ops.js";
export * from "./schema.js";
export * from "./validate.js";
export { mountExpressionEditor } from "./mount.js";
export type { ExpressionEditorOptions, ExpressionEditorHandle } from "./mount.js";
export {
  mountEffectsEditor, addSet, addEmit, removeAt, moveAt, updateAt, setArgAt, addArg, removeArgAt, seedValueSrc,
} from "./effects.js";
export type { EditorEffect, EffectsEditorOptions, EffectsEditorHandle } from "./effects.js";
export { renderConditionPreview, renderEffectsPreview } from "./preview.js";
export type { PreviewOptions } from "./preview.js";
export { valueWizard } from "./valuewizard.js";
export type { ValueWizardOptions } from "./valuewizard.js";
export type { FunctionTemplateSpec, EditCtx } from "./types.js";
