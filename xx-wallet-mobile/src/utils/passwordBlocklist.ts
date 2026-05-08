/**
 * Common-password blocklist.
 *
 * A curated list of the most-leaked passwords from public breach corpora
 * (HaveIBeenPwned, SecLists), filtered to length >= 8 since that's our
 * minimum length anyway.
 *
 * The wallet refuses to use any of these as a wallet password, regardless
 * of length-and-confirmation passing. This is a cheap, offline, dependency-
 * free lower bound on password strength — not a substitute for zxcvbn or
 * similar entropy estimation. The point is to refuse the worst offenders
 * (`password1234`, `12345678`, `qwerty123`, etc.) that are cracked in
 * milliseconds against any KDF, even N=131072 scrypt.
 *
 * Maintained by hand. Add entries when new common-password reports surface.
 */

const BLOCKLIST = new Set<string>([
  // The classics
  'password',
  'password1',
  'password12',
  'password123',
  'password1234',
  'passw0rd',
  'pa55word',
  'p@ssw0rd',
  'p@ssword',

  // Numeric runs
  '12345678',
  '123456789',
  '1234567890',
  '11111111',
  '00000000',
  '99999999',
  '88888888',
  '12341234',
  '87654321',
  '01234567',

  // Keyboard walks
  'qwerty123',
  'qwertyui',
  'qwertyuiop',
  'qazwsxedc',
  '1qaz2wsx',
  '1q2w3e4r',
  '1qazxsw2',
  'asdfghjk',
  'asdfghjkl',
  'zxcvbnm123',

  // Login phrases
  'letmein1',
  'letmein123',
  'welcome1',
  'welcome123',
  'iloveyou',
  'iloveyou1',
  'iloveyou123',

  // Names / nouns commonly seen
  'princess',
  'princess1',
  'sunshine',
  'starwars',
  'superman',
  'batman123',
  'pokemon1',
  'football',
  'football1',
  'football123',
  'baseball',
  'baseball1',
  'monkey123',
  'monkey1234',
  'dragon123',
  'dragon1234',
  'master123',
  'master1234',
  'shadow123',
  'mustang1',
  'mustang123',
  'freedom1',
  'jesus1234',
  'jesuschrist',
  'charlie1',
  'michael1',
  'michael123',
  'jennifer1',
  'ashley123',
  'jordan23',

  // Admin/system
  'admin123',
  'admin1234',
  'administrator',
  'adminadmin',
  'root1234',
  'rootroot',
  'test1234',
  'testtest',

  // Repeated chars
  'aaaaaaaa',
  'bbbbbbbb',
  'aaaa1111',
  'abcd1234',
  'abcdefgh',
  'abcdefghij',

  // Wallet-specific easy-to-imagine bad passwords
  'cryptocurrency',
  'bitcoin12',
  'ethereum1',
  'wallet123',
  'walletwallet',
  'mywallet1',
  'xxnetwork',
  'xxnetwork1',
]);

/**
 * Returns true if the (case-insensitively normalized) password is in the
 * blocklist. Lowercasing means `Password123` is also caught.
 */
export function isCommonPassword(password: string): boolean {
  return BLOCKLIST.has(password.toLowerCase());
}
