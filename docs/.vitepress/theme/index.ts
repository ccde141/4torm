import { h } from 'vue'
import DefaultTheme from 'vitepress/theme'
import AsciiBreathingField from './AsciiBreathingField.vue'
import './custom.css'

export default {
  extends: DefaultTheme,
  Layout: () => h(DefaultTheme.Layout, null, {
    'layout-top': () => h(AsciiBreathingField),
  }),
}
