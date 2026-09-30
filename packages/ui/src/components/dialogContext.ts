import type { InjectionKey, Ref } from 'vue'

export const DIALOG_OPEN: InjectionKey<Ref<boolean>> = Symbol('HelpixDialogOpen')
