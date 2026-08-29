const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("coupleLabDesktop", {
  getRuntimeInfo: () => ipcRenderer.invoke("desktop:get-runtime-info"),
  getBiometricEnrollmentSummary: () => ipcRenderer.invoke("desktop:get-biometric-enrollment-summary"),
  loadBiometricEnrollment: () => ipcRenderer.invoke("desktop:load-biometric-enrollment"),
  saveBiometricEnrollment: (state) => ipcRenderer.invoke("desktop:save-biometric-enrollment", state),
  clearBiometricEnrollment: (partnerId) =>
    ipcRenderer.invoke("desktop:clear-biometric-enrollment", partnerId),
  getVoiceModelStatus: () => ipcRenderer.invoke("desktop:get-voice-model-status"),
  extractVoiceEmbedding: (samples) =>
    ipcRenderer.invoke("desktop:extract-voice-embedding", { sampleRate: 16000, samples }),
  getTranscriptionModelStatus: () => ipcRenderer.invoke("desktop:get-transcription-model-status"),
  transcribeAudio: (samples, language) =>
    ipcRenderer.invoke("desktop:transcribe-audio", { sampleRate: 16000, samples, language }),
  installTranscriptionModel: (model) =>
    ipcRenderer.invoke("desktop:install-transcription-model", { model }),
  onTranscriptionModelProgress: (listener) => {
    const handler = (_event, progress) => listener(progress);
    ipcRenderer.on("desktop:transcription-model-progress", handler);
    return () => ipcRenderer.removeListener("desktop:transcription-model-progress", handler);
  },
  saveCloudKey: (provider, key) => ipcRenderer.invoke("desktop:cloud-save-key", { provider, key }),
  getCloudKeyStatus: () => ipcRenderer.invoke("desktop:cloud-key-status"),
  clearCloudKey: () => ipcRenderer.invoke("desktop:cloud-clear-key"),
  cloudComplete: (request) => ipcRenderer.invoke("desktop:cloud-complete", request)
});
