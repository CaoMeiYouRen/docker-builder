import { defineConfig } from 'tsup'

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    splitting: false,
    sourcemap: true,
    clean: true,
    dts: true,
    minify: false,
    // external: [],
    noExternal: ['dayjs'], // /(.*)/ 将依赖打包到一个文件中
    // bundle: true,
})
