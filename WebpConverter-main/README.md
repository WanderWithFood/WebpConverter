# 🌌 BINI In-House WebP Converter

A modern, high-performance, browser-based WebP image converter that allows users to convert multiple image formats into optimized WebP files with interactive editing, batch processing, and ZIP download support.

## ✨ Features

- 📁 Bulk image upload with Drag & Drop support
- 🖼️ Supports JPG, JPEG, PNG, BMP, GIF, AVIF, and WebP
- 🔄 Rotate and Flip images
- 📐 Aspect Ratio options (Original, Landscape, Portrait, Square)
- 🎚️ Adjustable WebP Quality (10%–100%)
- ⚡ Lossy and Lossless compression modes
- 📊 Real-time conversion progress
- 📦 Download all converted images as a ZIP archive
- 🚫 Unsupported file validation
- 🔒 100% Client-side processing (No server upload)
- 🌌 Modern Galaxy-themed responsive UI

## 🛠️ Technologies Used

- HTML5
- CSS3
- JavaScript (ES6)
- JSZip
- Font Awesome
- Google Fonts

## 📂 Project Structure

```
├── index.html
├── style.css
├── script.js
└── README.md
```

## 🚀 Getting Started

1. Clone the repository.

```bash
git clone https://github.com/your-username/bini-webp-converter.git
```

2. Open the project folder.

3. Run `index.html` in your browser.

No installation or server setup is required.

## 📸 Supported Formats

| Input Formats | Output Format |
|--------------|---------------|
| JPG | WebP |
| JPEG | WebP |
| PNG | WebP |
| BMP | WebP |
| GIF | WebP |
| AVIF | WebP |
| WebP | Optimized WebP |

## 🔒 Privacy

All image processing is performed entirely inside your browser. Your images are never uploaded to any server, ensuring complete privacy and security.

### 🔐 Automatic Metadata Stripping (EXIF Removal)

**Critical Privacy Feature:** This converter automatically strips all embedded metadata from your images during conversion:

#### Removed Metadata Includes:
- **GPS/Location Data** - Latitude, longitude, altitude coordinates that identify where photos were taken
- **Device Information** - Camera model, serial numbers, device identifiers
- **Timestamps** - Date and time the photo was taken
- **Exposure & Camera Settings** - Aperture, ISO, focal length, etc.
- **All EXIF Tags** - Complete EXIF data removal
- **XMP & IPTC Data** - Extended metadata tags

#### How It Works:
When converting to WebP, the original image file is decoded into pixels and redrawn onto a canvas. The `canvas.toBlob()` method then encodes only the pixel content into the WebP file, automatically discarding all embedded metadata. **No EXIF data survives this process.**

#### Why This Matters:
Photos taken on smartphones often contain GPS coordinates showing the exact location where the photo was taken. Publishing these images online without stripping EXIF data can compromise privacy and security (restaurant locations, home addresses, etc.). This converter ensures that all converted WebP files are clean of location data and device-identifying information.

#### Security Guarantee:
✅ GPS coordinates are REMOVED  
✅ Device model information is REMOVED  
✅ Timestamps are REMOVED  
✅ All EXIF tags are REMOVED  
✅ Only pixel content is preserved

## 🎯 Key Highlights

- Fast batch conversion
- High-quality WebP optimization
- Interactive image editing
- ZIP archive download
- Responsive modern UI
- Browser-based processing

## 📜 License

This project is licensed under the MIT License.

---

⭐ If you like this project, don't forget to **Star** the repository!
