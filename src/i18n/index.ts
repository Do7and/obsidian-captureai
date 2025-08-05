import en from './en';
import zh from './zh';

const translations: Record<string, Record<string, string>> = {
  en,
  zh
};

export class I18n {
  private language: string;

  constructor(lang: string = 'en') {
    this.language = lang;
  }

  setLanguage(lang: string) {
    if (translations[lang]) {
      this.language = lang;
    }
  }

  t(key: string, params?: Record<string, string | number>): string {
    let translation = translations[this.language]?.[key] || translations['en']?.[key] || key;
    
    if (params) {
      Object.keys(params).forEach(param => {
        translation = translation.replace(new RegExp(`{{${param}}}`, 'g'), String(params[param]));
      });
    }
    
    return translation;
  }
}

// Create a global instance
export const i18n = new I18n();

// Helper function for easier access
export function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}