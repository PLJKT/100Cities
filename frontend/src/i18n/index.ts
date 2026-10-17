import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import id from './id.json';
import zh from './zh.json';

const stored = localStorage.getItem('lang') || 'en';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    id: { translation: id },
    zh: { translation: zh },
  },
  lng: stored,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => localStorage.setItem('lang', lng));

export default i18n;
