<script setup lang="ts">
import { RotateCw, Split, Trash2 } from '@lucide/vue'
import type { BranchSide, Piece } from '@/shared/document'

const props = defineProps<{ piece: Piece | null }>()
const emit = defineEmits<{
  rotate: [string]; remove: [string]
  update: [string, Partial<Pick<Piece, 'label' | 'height' | 'fallThreshold' | 'friction' | 'splitAngle' | 'frontalSide'>>]
}>()
function value(event: Event) { return (event.target as HTMLInputElement).value }
function number(event: Event) { return Number(value(event)) }
function commitAngle(event: Event) {
  if (!props.piece) return
  const splitAngle = Math.max(5, Math.min(85, number(event)))
  emit('update', props.piece.id, { splitAngle })
}
function setSide(side: BranchSide) {
  if (props.piece && props.piece.frontalSide !== side) emit('update', props.piece.id, { frontalSide: side })
}
</script>

<template>
  <section class="inspector">
    <div class="section-kicker"><span>02 / SELECTED</span><h2>元件属性</h2></div>
    <template v-if="piece">
      <label class="field-label">名称<input :value="piece.label" maxlength="18" @change="emit('update', piece.id, { label: value($event) })" /></label>
      <div class="field-pair">
        <label class="field-label">横坐标<input type="number" :value="piece.x.toFixed(1)" step="0.1" readonly /></label>
        <label class="field-label">纵坐标<input type="number" :value="piece.y.toFixed(1)" step="0.1" readonly /></label>
      </div>

      <template v-if="piece.kind === 'splitter'">
        <div class="splitter-inspector">
          <div class="splitter-inspector-title"><Split :size="13" /> 进入角分路</div>
          <label class="field-label">进入角度分界 <span>{{ (piece.splitAngle ?? 45).toFixed(0) }}°</span>
            <input type="range" min="5" max="85" step="1" :value="piece.splitAngle ?? 45"
              aria-label="进入角度分界"
              @input="commitAngle" @change="commitAngle" />
          </label>
          <div class="side-switch" role="group" aria-label="正面撞击导向支路">
            <button type="button" :class="{ active: (piece.frontalSide ?? 'left') === 'left' }"
              :aria-pressed="(piece.frontalSide ?? 'left') === 'left'" @click="setSide('left')">正面 → 左支路</button>
            <button type="button" :class="{ active: piece.frontalSide === 'right' }"
              :aria-pressed="piece.frontalSide === 'right'" @click="setSide('right')">正面 → 右支路</button>
          </div>
          <p class="routing-rule-note">
            入射角 &lt; {{ (piece.splitAngle ?? 45).toFixed(0) }}° 判为正面撞击，走{{ (piece.frontalSide ?? 'left') === 'left' ? '左' : '右' }}侧；
            ≥ 分界判为擦边撞击，走{{ (piece.frontalSide ?? 'left') === 'left' ? '右' : '左' }}侧。
            同一碰撞内的回弹 / 连续触碰只按首次角度定路。
          </p>
        </div>
      </template>

      <label v-else class="field-label">倾倒门槛 <span>{{ piece.fallThreshold.toFixed(1) }}</span>
        <input type="range" min="0.3" max="1.6" step="0.1" :value="piece.fallThreshold"
          @change="emit('update', piece.id, { fallThreshold: number($event) })" />
      </label>
      <div class="inspector-actions">
        <button @click="emit('rotate', piece.id)"><RotateCw :size="15" /> 旋转 15°</button>
        <button class="danger" @click="emit('remove', piece.id)"><Trash2 :size="15" /> 删除</button>
      </div>
      <p class="inspector-note">在场景中拖动，或使用方向键微调位置。</p>
    </template>
    <div v-else class="inspector-empty"><span class="empty-cross">＋</span><span>选择一个元件查看属性</span></div>
  </section>
</template>
