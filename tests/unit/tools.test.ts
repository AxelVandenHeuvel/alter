import { describe, expect, it } from 'vitest';
import { TOOL_INPUTS, TOOL_SPECS } from '../../src/agent/tools';

function walk(schema: unknown, visit: (node: Record<string, unknown>) => void): void {
  if (Array.isArray(schema)) schema.forEach((s) => walk(s, visit));
  else if (schema && typeof schema === 'object') {
    visit(schema as Record<string, unknown>);
    Object.values(schema).forEach((v) => walk(v, visit));
  }
}

describe('tool schemas', () => {
  it('are strict-tool-use compatible', () => {
    for (const spec of TOOL_SPECS) {
      walk(spec.inputSchema, (node) => {
        for (const key of ['$schema', 'minimum', 'maximum', 'minLength', 'maxLength', 'pattern']) {
          expect(node, `${spec.name} has ${key}`).not.toHaveProperty(key);
        }
        if (node.type === 'object') {
          expect(node.additionalProperties, `${spec.name} object must be closed`).toBe(false);
          expect(new Set(node.required as string[])).toEqual(new Set(Object.keys(node.properties as object)));
        }
      });
    }
  });

  it('keep the bounds the API schema cannot express', () => {
    const base = { title: 't', summary: 's', css: '', js: '', revises: null, focus: { mode: 'off', theme: 'auto', text_size: 'normal' } };
    expect(
      TOOL_INPUTS.propose_patch.safeParse({ ...base, dark_mode: { enabled: true, brightness: 100, contrast: 100, sepia: 0 } }).success,
    ).toBe(true);
    expect(
      TOOL_INPUTS.propose_patch.safeParse({ ...base, dark_mode: { enabled: true, brightness: 400, contrast: 100, sepia: 0 } }).success,
    ).toBe(false);
    expect(TOOL_INPUTS.query_selector.safeParse({ selector: 'a', extra: 1 }).success).toBe(false);
  });
});
