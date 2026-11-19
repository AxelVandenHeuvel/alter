import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'happy-dom',
    // Tests parse untrusted-looking HTML on purpose; the test DOM must never fetch scripts or stylesheets it references.
    environmentOptions: {
      happyDOM: { settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } },
    },
  },
});
