// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import App from './App.vue'

describe('App · splitter angle routing workflow', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) =>
      window.setTimeout(() => cb(performance.now()), 0))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
    SVGElement.prototype.setPointerCapture = vi.fn() as unknown as typeof SVGElement.prototype.setPointerCapture
    SVGElement.prototype.releasePointerCapture = vi.fn() as unknown as typeof SVGElement.prototype.releasePointerCapture
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    window.localStorage.clear()
  })

  it('runs the default fork, shows archived basis, then re-routes after a threshold edit', async () => {
    const wrapper = mount(App, { attachTo: document.body })

    // ---- initial run: 40° approach vs 45° => frontal => left => endpoint A reachable
    await wrapper.find('.run-button').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('分岔展开')
    }, { timeout: 2000 })
    await flushPromises()

    // endpoint chip reports reachable state with the route
    const reachedChip = wrapper.find('.endpoint-chip.reached')
    expect(reachedChip.exists()).toBe(true)
    expect(reachedChip.text()).toContain('终点 A')
    expect(reachedChip.text()).toContain('可达')
    expect(wrapper.find('.endpoint-chip.missed').exists()).toBe(false)

    // open the splitter event and inspect the persisted routing basis
    const forkRow = wrapper.findAll('button.event-row').find(row => row.text().includes('分岔展开'))
    expect(forkRow).toBeTruthy()
    await forkRow!.trigger('click')
    await flushPromises()

    const card = wrapper.find('.routing-card')
    expect(card.exists()).toBe(true)
    expect(card.text()).toContain('分路依据')
    expect(card.text()).toContain('40.0°')
    expect(card.text()).toContain('45°')
    expect(card.find('.routing-impact-tag').text()).toContain('正面')
    expect(card.find('.routing-side-tag').text()).toContain('左支路')
    // taken wire highlighted, other wire dimmed on canvas
    expect(wrapper.find('.mechanism-link.taken').exists()).toBe(true)
    expect(wrapper.find('.mechanism-link.untaken').exists()).toBe(true)

    // ---- select the splitter and lower the cutoff to 30°
    const splitterGroup = wrapper.findAll('g.scene-piece').find(g => g.find('.splitter-body').exists())
    expect(splitterGroup).toBeTruthy()
    await splitterGroup!.trigger('pointerdown')
    await flushPromises()

    const slider = wrapper.find('input[aria-label="进入角度分界"]')
    expect(slider.exists()).toBe(true)
    ;(slider.element as HTMLInputElement).value = '30'
    // Playwright-style fill commits through the input event.
    await slider.trigger('input')
    await flushPromises()

    // old replay must still explain the old event with the archived 45° cutoff
    expect(wrapper.find('.routing-card').text()).toContain('45°')
    expect(wrapper.find('.routing-card').text()).toContain('左支路')
    expect(wrapper.text()).toContain('旧版布局')

    // ---- re-simulate: 40° >= 30° => grazing => right => dead branch => endpoint missed
    await wrapper.find('.run-button').trigger('click')
    await vi.waitFor(() => {
      expect(wrapper.text()).toContain('不可达')
    }, { timeout: 2000 })
    await flushPromises()

    const rerunForkRow = wrapper.findAll('button.event-row').find(row => row.text().includes('分岔展开'))
    await rerunForkRow!.trigger('click')
    await flushPromises()

    const newCard = wrapper.find('.routing-card')
    expect(newCard.text()).toContain('30°')
    expect(newCard.find('.routing-impact-tag').text()).toContain('擦边')
    expect(newCard.find('.routing-side-tag').text()).toContain('右支路')

    expect(wrapper.find('.endpoint-chip.reached').exists()).toBe(false)
    const missedChip = wrapper.find('.endpoint-chip.missed')
    expect(missedChip.exists()).toBe(true)
    expect(missedChip.text()).toContain('终点 A')
    expect(missedChip.text()).toContain('不可达')
    expect(wrapper.find('.replay-summary.interrupted').exists()).toBe(true)

    wrapper.unmount()
  })
})
