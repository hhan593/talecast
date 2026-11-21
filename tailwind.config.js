/** @type {import('tailwindcss').Config} */
// NativeWind v4 web 要求 class 模式：css-interop 会手动 set colorScheme（media 模式下抛错，issue #93）
module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // 墨韵纸感语义色（docs/design/2026-11-18-v0.2.0-spec.md）
        // 约定：*–night 为夜读（暖黑）对应值；screens 用 dark:* 变体切换
        paper: { DEFAULT: '#F6F1E7', night: '#171310' },
        card: { DEFAULT: '#FDFBF5', night: '#221D16' },
        raised: { DEFAULT: '#F1EADC', night: '#2A241C' },
        ink: { DEFAULT: '#2C2822', night: '#EAE3D5' },
        muted: { DEFAULT: '#8C8272', night: '#9C917E' },
        faint: { DEFAULT: '#B3A992', night: '#6E675C' },
        line: { DEFAULT: '#E6DECE', night: '#332C22' },
        accent: { DEFAULT: '#B5442D', deep: '#8F3018', night: '#D4633F', soft: '#F3E2DB', nightsoft: '#3A2A20' },
        gold: { DEFAULT: '#A98B4F', night: '#C9A96A' },
        ok: { DEFAULT: '#4A6B3F', soft: '#E7EFE4', nightsoft: '#25301F' },
        danger: { DEFAULT: '#B5442D', night: '#D4633F', soft: '#F6E3DC', nightsoft: '#3A2118' },
        playerbar: { DEFAULT: '#2C2822', night: '#1D1812' },
      },
      fontFamily: {
        serif: ['"Noto Serif SC"', '"Songti SC"', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
