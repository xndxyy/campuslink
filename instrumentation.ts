export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateProductionConfig } =
      await import('@/lib/security/runtime-config');
    validateProductionConfig();
  }
}
