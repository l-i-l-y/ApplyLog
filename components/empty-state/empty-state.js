
Component({
  properties: {
    title: String,
    description: String,
    actionLabel: String,
    symbol: { type: String, value: '✦' }
  },
  methods: {
    act() {
      this.triggerEvent('action')
    }
  }
})
