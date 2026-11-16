/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // 与 docs/plan.md 的视觉方向一致：中性底 + 靛蓝主行动，后续随 P4 加固扩展 token
        primary: {
          DEFAULT: '#6366f1',
          foreground: '#ffffff',
        },
      },
    },
  },
  plugins: [],
};
