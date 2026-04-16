import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en/common.json';
import pt from './locales/pt/common.json';

export const SUPPORTED_LANGUAGES = ['en', 'pt'] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === 'string' && SUPPORTED_LANGUAGES.includes(value as AppLanguage);
}

void i18n.use(initReactI18next).init({
  lng: 'en',
  fallbackLng: 'en',
  defaultNS: 'common',
  ns: ['common'],
  interpolation: { escapeValue: false },
  resources: {
    en: { common: en },
    pt: { common: pt },
  },
});

export default i18n;
