export function isValidAccessKey(key) {
  if (!/^\d{44}$/.test(key)) return false;

  return isPlausibleAccessKey(key) && calculateAccessKeyDigit(key.slice(0, 43)) === Number(key[43]);
}

export function isPlausibleAccessKey(key) {
  if (!/^\d{44}$/.test(key)) return false;

  const stateCode = Number(key.slice(0, 2));
  const month = Number(key.slice(4, 6));
  const model = key.slice(20, 22);
  const validStateCodes = new Set([
    11, 12, 13, 14, 15, 16, 17,
    21, 22, 23, 24, 25, 26, 27,
    28, 29, 31, 32, 33, 35, 41,
    42, 43, 50, 51, 52, 53
  ]);

  return validStateCodes.has(stateCode)
    && month >= 1
    && month <= 12
    && ['55', '65'].includes(model);
}

function calculateAccessKeyDigit(first43Digits) {
  let factor = 2;
  let sum = 0;

  for (let index = first43Digits.length - 1; index >= 0; index -= 1) {
    sum += Number(first43Digits[index]) * factor;
    factor = factor === 9 ? 2 : factor + 1;
  }

  const digit = 11 - (sum % 11);
  return digit >= 10 ? 0 : digit;
}
