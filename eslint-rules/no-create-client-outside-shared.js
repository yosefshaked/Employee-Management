import process from 'node:process';
import path from 'node:path';

const projectRoot = process.cwd();
const allowedFiles = new Set([
  path.resolve(projectRoot, 'src/lib/supabase-client.js'),
  path.resolve(projectRoot, 'src/supabaseClient.js'),
]);

function isSourceFile(filename) {
  if (!filename || filename === '<input>' || filename === '<text>') {
    return false;
  }
  const normalized = path.resolve(filename);
  return normalized.startsWith(path.resolve(projectRoot, 'src'));
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow createClient usage outside the shared Supabase client module.',
    },
    schema: [],
    messages: {
      noCreateClient: 'Use the shared Supabase helpers instead of calling createClient directly.',
    },
  },
  create(context) {
    const filename = context.getFilename();
    if (!isSourceFile(filename)) {
      return {};
    }

    const normalized = path.resolve(filename);
    if (allowedFiles.has(normalized)) {
      return {};
    }

    const createClientNames = new Set();

    return {
      ImportDeclaration(node) {
        if (node.source.value !== '@supabase/supabase-js') {
          return;
        }
        for (const specifier of node.specifiers) {
          if (specifier.type === 'ImportSpecifier' && specifier.imported.name === 'createClient') {
            createClientNames.add(specifier.local.name);
          }
        }
      },
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && createClientNames.has(node.callee.name)) {
          context.report({ node, messageId: 'noCreateClient' });
        }
      },
    };
  },
};
