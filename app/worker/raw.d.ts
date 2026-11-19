// Vite's ?raw imports of the migrations (worker/testing.ts).
declare module '*.sql?raw' {
  const sql: string;
  export default sql;
}
