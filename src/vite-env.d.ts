/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_PROVIDER: string
  readonly VITE_FEATHERLESS_BASE_URL: string
  readonly VITE_FEATHERLESS_API_KEY: string
  readonly VITE_ABLITERATION_BASE_URL: string
  readonly VITE_ABLITERATION_API_KEY: string
  readonly VITE_SPARK_HOST: string
  readonly VITE_SPARK_PORT: string
  readonly VITE_SPARK_USE_PROXY: string
  readonly VITE_SPARK_API_KEY: string
  readonly VITE_MEMPALACE_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
