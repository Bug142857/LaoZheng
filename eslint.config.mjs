import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * 轻量 ESLint 门槛：当前历史代码没有统一 lint，先只启用 React Hooks 两条核心规则，
 * 避免一次性引入大量风格告警；后续可以再逐步加类型相关规则。
 */
export default tseslint.config(
  {
    ignores: ['out/**', 'release/**', 'node_modules/**', 'resources/**', '.secrets/**']
  },
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.ts', 'tests/**/*.ts'],
    linterOptions: {
      // 历史代码里已有大量 eslint-disable 注释，先不把「未使用的 disable」算进输出
      reportUnusedDisableDirectives: 'off'
    },
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      },
      globals: { ...globals.browser, ...globals.node }
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
)
