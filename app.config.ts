export default defineAppConfig({
  ui: {
    colors: {
      primary: 'emerald',
      neutral: 'slate'
    },
    button: {
      slots: {
        base: 'rounded-md'
      }
    },
    card: {
      slots: {
        root: 'rounded-lg'
      }
    }
  }
})
