
Component({
  properties: {
    item: { type: Object, value: null },
    compact: Boolean,
    showMenu: Boolean
  },
  methods: {
    openMenu() {
      this.triggerEvent('menu', { id: this.data.item.id })
    }
  }
})
