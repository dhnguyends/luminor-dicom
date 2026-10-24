---
title: Luminor
emoji: 🩻
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: apache-2.0
short_description: CT viewer for radiologists - window, MPR, MIP, measures
---

# Luminor - CT viewer demo

Luminor is a sleek CT viewer built around the seven things a radiologist does all day:
stack scrolling, window/level presets, multiplanar reconstruction (MPR), measurements
(distance, angle, ROI in Hounsfield units), slab MIP/MinIP, side-by-side comparison, and
findings with a report draft. The interface is in English and French.

- **Source code, user guide and Windows app:** <https://github.com/dhnguyends/luminor-dicom>
- **User guide:** [English](https://dhnguyends.github.io/luminor-dicom/guide.html) ·
  [Français](https://dhnguyends.github.io/luminor-dicom/guide-fr.html)

## About this demo

- It shows six anonymized chest CT scans from the public **LIDC-IDRI** collection.
- It is **read-only**: the images folder cannot be changed here. Markers and measurements you add
  are kept in your own browser only.
- To view your own scans, run Luminor on your computer (Windows app or Python), where your files
  never leave your machine. Do not upload patient data to a public website.

**Luminor is not a medical device. It must not be used for diagnosis.**

## Data credits

The images come from The Cancer Imaging Archive (TCIA), LIDC-IDRI collection, licensed under
[Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/):

- Armato III, S. G., et al. (2015). *Data From LIDC-IDRI* [Data set]. The Cancer Imaging Archive.
  <https://doi.org/10.7937/K9/TCIA.2015.LO9QL9SX>
- Armato III, S. G., et al. (2011). The Lung Image Database Consortium (LIDC) and Image Database
  Resource Initiative (IDRI): a completed reference database of lung nodules on CT scans.
  *Medical Physics*, 38(2), 915-931. <https://doi.org/10.1118/1.3528204>
- Clark, K., et al. (2013). The Cancer Imaging Archive (TCIA): Maintaining and Operating a Public
  Information Repository. *Journal of Digital Imaging*, 26(6), 1045-1057.
  <https://doi.org/10.1007/s10278-013-9622-7>

The authors acknowledge the National Cancer Institute and the Foundation for the National
Institutes of Health, and their critical role in the creation of the free publicly available
LIDC/IDRI Database used here.

Luminor is released under the Apache License 2.0.
