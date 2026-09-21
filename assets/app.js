"use strict";

const base = [
        {
          serial: "DVH-2026-78421",
          name: "Ahmed Ali",
          course: "Web Development Essentials",
          date: "12 Sep 2026",
          status: "valid",
        },
      ];
      let certs =
          JSON.parse(localStorage.getItem("trustpass-certs") || "null") || base,
        active;
      const $ = (s) => document.querySelector(s);
      document.body.dataset.view = "verify";
      function cleanPrefix() {
        return (
          $("#newPrefix")?.value
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, "")
            .slice(0, 6) || "DVH"
        );
      }
      function proposedSerial() {
        const year = new Date().getFullYear();
        let serial = "";
        do {
          const random = new Uint32Array(1);
          crypto.getRandomValues(random);
          const number = String(10000 + (random[0] % 90000));
          serial = cleanPrefix() + "-" + year + "-" + number;
        } while (find(serial));
        return serial;
      }
      function refreshSerialSuggestion() {
        $("#serialSuggestion").textContent = proposedSerial();
      }
      function save() {
        localStorage.setItem("trustpass-certs", JSON.stringify(certs));
      }

      const CERT_API = "/api/certificates";
      let cloudSyncAvailable = false;

      function cloudSafeCertificate(cert) {
        if (!cert) return cert;
        return {
          serial: cert.serial,
          name: cert.name,
          course: cert.course,
          date: cert.date,
          status: cert.status || "valid",
          pdf: cert.pdf && !String(cert.pdf).startsWith("data:") ? cert.pdf : undefined,
        };
      }

      async function syncCertificateRemote(cert) {
        try {
          const response = await fetch(CERT_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cloudSafeCertificate(cert)),
          });
          cloudSyncAvailable = response.ok;
          return response.ok;
        } catch (error) {
          cloudSyncAvailable = false;
          return false;
        }
      }

      async function hydrateRemoteCerts() {
        try {
          const response = await fetch(CERT_API, { cache: "no-store" });
          if (!response.ok) throw new Error("cloud storage unavailable");
          const remote = await response.json();
          const remoteCerts = Array.isArray(remote.certificates) ? remote.certificates : [];
          const map = new Map();
          [...remoteCerts, ...certs].forEach((cert) => {
            if (cert?.serial) map.set(cert.serial.toUpperCase(), cert);
          });
          certs = Array.from(map.values());
          cloudSyncAvailable = true;
          save();
          render();

          // Migrate any existing local-only metadata the first time cloud storage is enabled.
          const remoteSerials = new Set(remoteCerts.map((x) => x.serial?.toUpperCase()));
          for (const cert of certs) {
            if (!remoteSerials.has(cert.serial?.toUpperCase())) {
              await syncCertificateRemote(cert);
            }
          }
        } catch (error) {
          cloudSyncAvailable = false;
        }
      }
      function statusMeta(status) {
        const normalized = String(status || "valid").toLowerCase();
        if (normalized === "revoked") {
          return { label: "ملغاة", className: "badge badge-revoked" };
        }
        if (normalized === "expired") {
          return { label: "منتهية", className: "badge badge-expired" };
        }
        return { label: "موثّقة", className: "badge" };
      }

      function render() {
        const q = $("#search").value?.toLowerCase() || "";
        const rows = $("#rows");
        rows.replaceChildren();

        certs
          .filter((certificate) =>
            (certificate.name + certificate.serial + certificate.course)
              .toLowerCase()
              .includes(q),
          )
          .forEach((certificate) => {
            const tr = document.createElement("tr");
            const meta = statusMeta(certificate.status);

            const values = [
              ["المتدرب", certificate.name, true],
              ["الدورة", certificate.course, false],
              ["السيريال", certificate.serial, false],
            ];

            values.forEach(([label, value, strong]) => {
              const td = document.createElement("td");
              td.dataset.label = label;
              if (label === "السيريال") td.dir = "ltr";
              const node = document.createElement(strong ? "b" : "span");
              node.textContent = value;
              td.appendChild(node);
              tr.appendChild(td);
            });

            const statusTd = document.createElement("td");
            statusTd.dataset.label = "الحالة";
            const badge = document.createElement("span");
            badge.className = meta.className;
            badge.textContent = meta.label;
            statusTd.appendChild(badge);
            tr.appendChild(statusTd);

            const actionTd = document.createElement("td");
            actionTd.dataset.label = "الإجراء";
            const button = document.createElement("button");
            button.className = "link";
            button.textContent = "عرض";
            button.onclick = () => showCert(certificate);
            actionTd.appendChild(button);
            tr.appendChild(actionTd);

            rows.appendChild(tr);
          });

        $("#total").textContent = certs.length;
        $("#verified").textContent = certs.filter(
          (certificate) => (certificate.status || "valid") === "valid",
        ).length;
      }

      function find(s) {
        return certs.find((c) => c.serial === s.trim().toUpperCase());
      }
      function show(v) {
        document
          .querySelectorAll(".view,.role")
          .forEach((x) => x.classList.remove("active"));
        $("#" + v).classList.add("active");
        document.querySelector(`[data-v="${v}"]`)?.classList.add("active");
        document.body.dataset.view = v;
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
      function buildCertificatePdf(c) {
        const { jsPDF } = window.jspdf;
        let d = new jsPDF({ orientation: "landscape" });
        d.setFillColor(15, 31, 58);
        d.rect(0, 0, 297, 38, "F");
        d.setTextColor(255);
        d.setFontSize(24);
        d.text("DevsHub Academy.cc - Certificate of Completion", 148, 24, { align: "center" });
        d.setTextColor(30, 45, 70);
        d.setFontSize(18);
        d.text("This certifies that", 148, 65, { align: "center" });
        d.setFontSize(30);
        d.text(c.name, 148, 88, { align: "center" });
        d.setFontSize(17);
        d.text("has successfully completed", 148, 108, { align: "center" });
        d.setFontSize(22);
        d.text(c.course, 148, 126, { align: "center" });
        d.setFontSize(12);
        d.text("Certificate serial: " + c.serial, 148, 157, { align: "center" });
        d.text("Issued: " + c.date + " | Verified by DevsHub Academy.cc", 148, 168, { align: "center" });
        return d;
      }
      function loadPdfPreview(c) {
        $("#previewName").textContent = c.name;
        $("#previewCourse").textContent = c.course;
        $("#previewSerial").textContent = c.serial;
        if (c.pdf) {
          $("#generatedPdfPreview").style.display = "none";
          $("#pdfPreview").style.display = "block";
          $("#pdfPreview").src = c.pdf;
          return;
        }
        $("#pdfPreview").style.display = "none";
        $("#generatedPdfPreview").style.display = "grid";
      }
      function applyPublicStatus(certificate) {
        const status = String(certificate.status || "valid").toLowerCase();
        const banner = $("#statusBanner");
        const icon = $("#statusIcon");
        const title = $("#statusTitle");
        const description = $("#statusDescription");
        const pill = $("#statusPill");
        const recordStatus = $("#recordStatus");
        const recordMatch = $("#recordMatchLabel");

        banner.classList.remove("is-valid", "is-revoked", "is-expired");
        pill.classList.remove("status-valid", "status-revoked", "status-expired");

        if (status === "revoked") {
          banner.classList.add("is-revoked");
          icon.textContent = "!";
          title.textContent = "تم إلغاء هذا الاعتماد";
          description.textContent =
            "السجل موجود في DevsHub Academy، لكن حالة الاعتماد الحالية هي ملغاة.";
          pill.textContent = "REVOKED";
          pill.classList.add("status-revoked");
          recordStatus.textContent = "× ملغاة";
          recordStatus.className = "record-valid record-revoked";
          recordMatch.textContent = "Record found";
          return;
        }

        if (status === "expired") {
          banner.classList.add("is-expired");
          icon.textContent = "!";
          title.textContent = "انتهت صلاحية هذا الاعتماد";
          description.textContent =
            "تم العثور على السجل، لكن حالة الاعتماد الحالية تشير إلى انتهاء الصلاحية.";
          pill.textContent = "EXPIRED";
          pill.classList.add("status-expired");
          recordStatus.textContent = "! منتهية";
          recordStatus.className = "record-valid record-expired";
          recordMatch.textContent = "Record found";
          return;
        }

        banner.classList.add("is-valid");
        icon.textContent = "✓";
        title.textContent = "سجل الشهادة مطابق وصالح";
        description.textContent =
          "تم العثور على هذا الاعتماد في سجل DevsHub Academy العام.";
        pill.textContent = "VALID";
        pill.classList.add("status-valid");
        recordStatus.textContent = "✓ صالح";
        recordStatus.className = "record-valid";
        recordMatch.textContent = "Matched";
      }

      function showCert(c) {
        if (!c) {
          $("#badSerial").textContent = $("#serial").value || "لا يوجد سيريال";
          $("#resultModal").classList.add("show");
          return;
        }

        active = c;
        $("#certName").textContent = c.name;
        $("#certCourse").textContent = c.course;
        $("#certSerial").textContent = c.serial;
        $("#certDate").textContent = c.date;
        $("#recordIdentity").textContent = c.serial;
        applyPublicStatus(c);
        loadPdfPreview(c);
        location.hash = "certificate/" + encodeURIComponent(c.serial);
        show("certificate");
      }

      function setVerifyLoading(loading) {
        const button = $("#verifyBtn");
        button.disabled = loading;
        button.classList.toggle("is-loading", loading);
        button.innerHTML = loading
          ? 'جاري مطابقة السجل <span>•••</span>'
          : 'تحقق من السجل <span>↗</span>';
      }

      async function fetchCertificateBySerial(serial) {
        try {
          const response = await fetch(
            CERT_API + "?serial=" + encodeURIComponent(serial),
            { cache: "no-store" },
          );
          if (response.status === 404) return null;
          if (!response.ok) throw new Error("verification request failed");
          const payload = await response.json();
          return payload.certificate || null;
        } catch (error) {
          return null;
        }
      }

      async function verifySerial(value) {
        const serial = String(value || "").trim().toUpperCase();
        if (!serial) {
          $("#badSerial").textContent = "اكتب الرقم التسلسلي أولاً";
          $("#resultModal").classList.add("show");
          return false;
        }

        $("#serial").value = serial;
        setVerifyLoading(true);

        try {
          let certificate = find(serial);
          if (!certificate) certificate = await fetchCertificateBySerial(serial);

          if (certificate) {
            const existing = certs.findIndex(
              (item) => item.serial?.toUpperCase() === certificate.serial?.toUpperCase(),
            );
            if (existing >= 0) certs[existing] = { ...certs[existing], ...certificate };
            else certs.unshift(certificate);
            showCert(certificate);
            return true;
          }

          $("#badSerial").textContent = serial;
          $("#resultModal").classList.add("show");
          return false;
        } finally {
          setVerifyLoading(false);
        }
      }

      $('.role[data-v="verify"]').onclick = () => {
        location.hash = "";
        show("verify");
      };
      $('.role[data-v="admin"]').onclick = async () => {
        location.hash = "admin";
        show("admin");
        await hydrateRemoteCerts();
      };

      $("#demoSerialBtn").onclick = () => {
        $("#serial").value = "DVH-2026-78421";
        $("#serial").focus();
      };

      $("#verifyBtn").onclick = () => verifySerial($("#serial").value);
      $("#serial").onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          verifySerial(e.target.value);
        }
      };
      $("#backBtn").onclick = () => {
        location.hash = "";
        show("verify");
      };
      $("#search").oninput = render;
      $("#addOpen").onclick = () => {
        refreshSerialSuggestion();
        $("#addModal").classList.add("show");
      };
      $("#cancelAdd").onclick = () => $("#addModal").classList.remove("show");
      $("#newPrefix").oninput = refreshSerialSuggestion;
      function closeAdminTool() {
        $("#adminToolModal").classList.remove("show");
      }
      function openAdminTool(title, body, actionLabel, action) {
        $("#adminToolTitle").textContent = title;
        $("#adminToolBody").innerHTML = body;
        $("#adminToolPrimary").textContent = actionLabel;
        $("#adminToolPrimary").onclick = () => {
          action?.();
          closeAdminTool();
        };
        $("#adminToolModal").classList.add("show");
      }
      function setAdminView(view) {
        document.querySelectorAll("[data-admin-view]").forEach((b) =>
          b.classList.toggle("side-active", b.dataset.adminView === view),
        );
        if (view === "verify") {
          location.hash = "";
          show("verify");
          return;
        }
        if (view === "dashboard" || view === "certificates") {
          $("#adminHeading").textContent =
            view === "dashboard" ? "لوحة إدارة الشهادات" : "الشهادات الصادرة";
          $("#adminSubheading").textContent =
            view === "dashboard"
              ? "أصدر واعرض وتحقق من جميع الشهادات من مكان واحد."
              : "ابحث في سجلات الشهادات واعرض صفحة كل متدرب.";
          $("#certificateTableTitle").textContent =
            view === "dashboard" ? "آخر الشهادات الصادرة" : "كل الشهادات";
          return;
        }
        const tools = {
          bulk: [
            "الإصدار الجماعي",
            '<p>ارفع ملف CSV يحتوي اسم المتدرب واسم الدورة لإصدار عدة شهادات دفعة واحدة.</p><label class="soft upload" style="margin-top:14px">▧ اختيار ملف CSV<input type="file" accept=".csv" /></label>',
            "متابعة",
          ],
          templates: [
            "قوالب الشهادات",
            '<p>القالب النشط: <b>الشهادة المهنية الرسمية</b></p><div class="tip">يمكنك تخصيص الشعار والألوان والحقول عند ربط النظام بالخدمة الخلفية.</div>',
            "تحديد القالب",
          ],
          reports: [
            "تقرير الأداء",
            '<p>هذا الشهر: <b>' + certs.length + '</b> شهادة صادرة و <b>86</b> عملية تحقق ناجحة اليوم.</p><div class="tip">ستظهر التقارير التفصيلية هنا عند ربط بيانات المؤسسة.</div>',
            "تحديث التقرير",
          ],
          settings: [
            "إعدادات المؤسسة",
            '<p>هوية المنصة الحالية: <b>DevsHub Academy.cc</b></p><div class="tip">تخصيص الهوية، دومين التحقق، وشعار المؤسسة متاح في النسخة الكاملة.</div>',
            "حفظ الإعدادات",
          ],
        };
        const tool = tools[view];
        if (tool) openAdminTool(tool[0], tool[1], tool[2]);
      }
      document.querySelectorAll("[data-admin-view]").forEach((button) => {
        button.onclick = () => setAdminView(button.dataset.adminView);
      });
      $("#closeAdminTool").onclick = closeAdminTool;
      $("#saveCert").onclick = async () => {
        let n = $("#newName").value.trim(),
          c = $("#newCourse").value.trim();
        if (!n || !c) {
          alert("اكتب اسم المتدرب والدورة");
          return;
        }
        let serial = proposedSerial();
        let pdf;
        const pdfFile = $("#newPdf").files[0];
        if (pdfFile) {
          if (pdfFile.size > 2500000) {
            alert("يرجى اختيار ملف PDF أصغر من 2.5MB للتجربة");
            return;
          }
          pdf = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(pdfFile);
          });
        }
        let x = {
          serial,
          name: n,
          course: c,
          date: new Date().toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }),
          pdf,
        };
        certs.unshift(x);
        save();
        render();
        syncCertificateRemote(x);
        $("#addModal").classList.remove("show");
        $("#newName").value = "";
        $("#newCourse").value = "";
        $("#newPdf").value = "";
        refreshSerialSuggestion();
        alert("تم إنشاء الشهادة. كود التحقق: " + serial);
      };
      $("#closeResult").onclick = () =>
        $("#resultModal").classList.remove("show");
      let qrScanFrame = 0;

      function extractSerialFromQr(raw) {
        const text = String(raw || "").trim();
        const direct = text.match(/[A-Z0-9]{2,10}-\d{4}-\d{4,12}/i);
        if (direct) return direct[0].toUpperCase();
        const route = text.match(/certificate\/([^?#/]+)/i);
        if (route) return decodeURIComponent(route[1]).trim().toUpperCase();
        try {
          const url = new URL(text);
          const fromQuery = url.searchParams.get("serial") || url.searchParams.get("certificate");
          if (fromQuery) return fromQuery.trim().toUpperCase();
        } catch (e) {}
        return "";
      }

      function stopCameraScanner() {
        cancelAnimationFrame(qrScanFrame);
        qrScanFrame = 0;
        window.cam?.getTracks().forEach((t) => t.stop());
        window.cam = null;
        $("#video").srcObject = null;
        $("#cameraModal").classList.remove("show");
      }

      async function handleDecodedQr(raw) {
        const serial = extractSerialFromQr(raw);
        if (!serial) return false;
        $("#serial").value = serial;
        stopCameraScanner();
        await verifySerial(serial);
        return true;
      }

      function decodeQrFromCanvas(canvas, context) {
        if (!window.jsQR || !canvas.width || !canvas.height) return "";
        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = window.jsQR(image.data, image.width, image.height, {
          inversionAttempts: "attemptBoth",
        });
        return code?.data || "";
      }

      function scanCameraFrame() {
        const video = $("#video");
        const canvas = $("#qrCanvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
          const maxWidth = 900;
          const scale = Math.min(1, maxWidth / video.videoWidth);
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const raw = decodeQrFromCanvas(canvas, ctx);
          if (raw) {
            handleDecodedQr(raw);
            return;
          }
        }
        qrScanFrame = requestAnimationFrame(scanCameraFrame);
      }

      async function cam() {
        if (!navigator.mediaDevices?.getUserMedia) {
          alert("المتصفح الحالي لا يسمح باستخدام الكاميرا. استخدم خيار رفع صورة QR.");
          return;
        }
        if (!window.jsQR) {
          alert("تعذر تحميل قارئ QR. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.");
          return;
        }
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false,
          });
          window.cam = stream;
          $("#video").srcObject = stream;
          $("#cameraHint").textContent = "وجّه رمز QR داخل الإطار";
          $("#cameraModal").classList.add("show");
          await $("#video").play().catch(() => {});
          cancelAnimationFrame(qrScanFrame);
          qrScanFrame = requestAnimationFrame(scanCameraFrame);
        } catch (e) {
          alert("تعذر فتح الكاميرا. اسمح بصلاحية الكاميرا أو استخدم رفع صورة QR.");
        }
      }

      async function decodeQrImageFile(file) {
        if (!file || !window.jsQR) return "";
        const bitmap = await createImageBitmap(file).catch(() => null);
        const canvas = $("#qrCanvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        if (bitmap) {
          const maxWidth = 1600;
          const scale = Math.min(1, maxWidth / bitmap.width);
          canvas.width = Math.max(1, Math.round(bitmap.width * scale));
          canvas.height = Math.max(1, Math.round(bitmap.height * scale));
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          bitmap.close?.();
          return decodeQrFromCanvas(canvas, ctx);
        }

        return await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const image = new Image();
            image.onload = () => {
              const maxWidth = 1600;
              const scale = Math.min(1, maxWidth / image.width);
              canvas.width = Math.max(1, Math.round(image.width * scale));
              canvas.height = Math.max(1, Math.round(image.height * scale));
              ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
              resolve(decodeQrFromCanvas(canvas, ctx));
            };
            image.onerror = () => resolve("");
            image.src = reader.result;
          };
          reader.onerror = () => resolve("");
          reader.readAsDataURL(file);
        });
      }

      $("#cameraBtn").onclick = cam;
      $("#closeCamera").onclick = stopCameraScanner;

      $("#imageInput").onchange = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        const raw = await decodeQrImageFile(file);
        event.target.value = "";
        if (!raw) {
          $("#badSerial").textContent = "لم يتم العثور على QR صالح في الصورة";
          $("#resultModal").classList.add("show");
          return;
        }
        await handleDecodedQr(raw);
      };

      function certificatePdfBlobUrl(cert) {
        if (cert.pdf) return cert.pdf;
        if (!window.jspdf) return "";
        const doc = buildCertificatePdf(cert);
        const blob = doc.output("blob");
        return URL.createObjectURL(blob);
      }

      $("#openPdfBtn").onclick = () => {
        if (!active) return;
        const url = certificatePdfBlobUrl(active);
        if (!url) {
          alert("تعذر تجهيز ملف PDF حالياً.");
          return;
        }
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        if (!opened) location.href = url;
        if (!active.pdf && url.startsWith("blob:")) {
          setTimeout(() => URL.revokeObjectURL(url), 60000);
        }
      };

      $("#downloadBtn").onclick = () => {
        if (!active) return;
        if (active.pdf) {
          const a = document.createElement("a");
          a.href = active.pdf;
          a.download = "DevsHub-" + active.serial + ".pdf";
          a.target = "_blank";
          document.body.appendChild(a);
          a.click();
          a.remove();
          return;
        }
        if (!window.jspdf) {
          alert("تعذر تحميل مولد PDF. استخدم زر فتح PDF أو أعد المحاولة.");
          return;
        }
        buildCertificatePdf(active).save("DevsHub-" + active.serial + ".pdf");
      };
      render();

      async function initializeApp() {
        const hash = location.hash.split("/");
        if (hash[0] === "#certificate" && hash[1]) {
          const serial = decodeURIComponent(hash[1]);
          const local = find(serial);
          if (local) showCert(local);
          else {
            const remote = await fetchCertificateBySerial(serial);
            if (remote) showCert(remote);
            else show("verify");
          }
          return;
        }

        if (location.hash === "#admin") {
          show("admin");
          await hydrateRemoteCerts();
        }
      }

      initializeApp();
