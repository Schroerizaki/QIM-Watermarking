# QAM Watermarking (Image Digital Watermarking using Quadrature Amplitude Modulation)

An advanced digital image watermarking system that utilizes **Quadrature Amplitude Modulation (QAM)** to embed robust, imperceptible watermark data into host images. This project demonstrates how telecommunication modulation techniques can be effectively applied to digital image security, copyright protection, and data hiding.

---

## 📌 Project Overview

Digital watermarking is crucial for copyright protection in the digital age. This project implements a steganographic/watermarking technique where the watermark data (can be text or a binary image) is modulated using **QAM** (e.g., 4-QAM, 16-QAM, or 64-QAM) and then embedded into the frequency domain of a host image (typically using Discrete Cosine Transform - DCT, or Discrete Wavelet Transform - DWT).

### Key Features
* **Multi-level QAM Modulation:** Supports 4-QAM, 16-QAM, and 64-QAM for varying data capacities.
* **Frequency Domain Embedding:** Uses DCT/DWT coefficients to ensure the watermark is highly imperceptible to the human eye.
* **Robustness Evaluation:** Includes metrics to test resistance against common attacks (noise, compression, cropping).
* **Performance Metrics:** Automatic calculation of **PSNR** (Peak Signal-to-Noise Ratio) for image quality and **BER** (Bit Error Rate) for watermark extraction accuracy.

---

## 🚀 How It Works

The workflow of this QAM Watermarking system is divided into two main stages:

### 1. Embedding Process
1.  **Convert** the watermark data into a binary bitstream.
2.  **Modulate** the bitstream into QAM symbols (mapping bits to complex constellations).
3.  **Transform** the host image into the frequency domain (e.g., via 2D-DCT).
4.  **Embed** the QAM symbols into the selected high/mid-frequency coefficients.
5.  **Inverse Transform** (e.g., 2D-IDCT) to generate the watermarked image.

### 2. Extraction Process
1.  **Transform** the watermarked image into the frequency domain.
2.  **Extract** the modulated QAM symbols from the designated coefficients.
3.  **Demodulate** the QAM symbols back into a binary bitstream.
4.  **Reconstruct** the original watermark data.

---

## ⚙️ Installation & Prerequisites

Make sure you have Python installed (3.8 or higher recommended). Clone this repository and install the required dependencies:

```bash
# Clone the repository
git clone [https://github.com/yourusername/qam-watermarking.git](https://github.com/yourusername/qam-watermarking.git)
cd qam-watermarking

# Install dependencies
pip install -r requirements.txt
