export const getLocale = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en-ZA';
  }
};

export const getCurrencyForLocale = (locale = getLocale()) => {
  return 'ZAR';
};

export const formatCurrency = (amount: number, currency: string, locale = getLocale()) => {
  try {
    return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR' }).format(amount);
  } catch {
    return `R ${amount.toFixed(2)}`;
  }
};
