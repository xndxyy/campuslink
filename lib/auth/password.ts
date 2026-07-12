const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{12,}$/;

export function isPasswordValid(password: string): boolean {
  return passwordPattern.test(password);
}
