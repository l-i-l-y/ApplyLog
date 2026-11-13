
Component({
  properties: {
    title: String,
    description: String,
    actionLabel: String,
    icon: { type: String, value: 'file-text-primary' }
  },
  methods: {
    act() {
      this.triggerEvent('action')
    }
  }
})