import * as openai from './openai.js';
import * as anthropic from './anthropic.js';
import * as command from './command.js';
import * as http from './http.js';
import * as module from './module.js';
import * as mock from './mock.js';

export const adapters = { 'openai-compatible': openai, anthropic, command, http, module, mock };

export const adapterNames = Object.keys(adapters);

/** Build the object that answers questions for one component. */
export async function createAdapter(component, baseDir) {
  const adapter = adapters[component.adapter];
  if (!adapter)
    throw new Error(
      `component "${component.id}": unknown adapter "${component.adapter}" (known: ${adapterNames.join(', ')})`,
    );
  return adapter.create({ options: component.options ?? {}, baseDir, component });
}
