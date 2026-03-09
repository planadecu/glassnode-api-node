import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import typescript from '@rollup/plugin-typescript';
import terser from '@rollup/plugin-terser';

export default {
  input: 'src/index.ts',
  output: [
    {
      file: 'dist/glassnode-api.umd.min.js',
      format: 'umd',
      name: 'GlassnodeAPI',
      sourcemap: true,
      plugins: [terser()],
    },
    {
      file: 'dist/glassnode-api.esm.min.js',
      format: 'es',
      sourcemap: true,
      plugins: [terser()],
    },
  ],
  plugins: [
    resolve({
      browser: true,
      preferBuiltins: false,
    }),
    commonjs(),
    typescript({
      tsconfig: './tsconfig.browser.json',
    }),
  ],
};
