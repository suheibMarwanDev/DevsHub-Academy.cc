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
        return cleanPrefix() + "-" + new Date().getFullYear() + "-AUTO";
      }
      function refreshSerialSuggestion() {
        $("#serialSuggestion").textContent = proposedSerial();
      }
      function save() {
        localStorage.setItem("trustpass-certs", JSON.stringify(certs));
      }

      const CERT_API = "/api/certificates";
      const AUTH_API = "/api/auth";
      const STORAGE_API = "/api/storage";
      let cloudSyncAvailable = false;
      let storageProvider = "demo";
      let dashboardMetrics = null;
      let authState = {
        checked: false,
        authenticated: false,
        demoMode: true,
        user: null,
        membership: null,
        memberships: [],
      };

      function updateAuthUi() {
        const logout = $("#logoutBtn");
        const switcher = $("#orgSwitcher");
        if (!logout || !switcher) return;

        logout.hidden =
          authState.demoMode ||
          !authState.authenticated ||
          !authState.user;

        const memberships = Array.isArray(authState.memberships)
          ? authState.memberships
          : [];

        switcher.replaceChildren();
        memberships.forEach((item) => {
          const option = document.createElement("option");
          option.value = item.organization?.slug || "";
          option.textContent =
            item.organization?.display_name ||
            item.organization?.name ||
            item.organization?.slug ||
            "Organization";
          option.selected =
            item.organization?.slug ===
            authState.membership?.organization?.slug;
          switcher.appendChild(option);
        });

        switcher.hidden =
          authState.demoMode ||
          !authState.authenticated ||
          memberships.length < 2;
      }

      function showLoginError(message) {
        const error = $("#loginError");
        error.textContent = message || "";
        error.hidden = !message;
      }

      function openLoginModal(message = "") {
        showLoginError(message);
        $("#loginModal").classList.add("show");
        $("#loginModal").setAttribute("aria-hidden", "false");
        setTimeout(() => $("#loginEmail")?.focus(), 40);
      }

      function closeLoginModal() {
        $("#loginModal").classList.remove("show");
        $("#loginModal").setAttribute("aria-hidden", "true");
        showLoginError("");
      }

      async function loadAdminSession(force = false) {
        if (authState.checked && !force) return authState;

        try {
          const response = await fetch(AUTH_API + "/session", {
            cache: "no-store",
            credentials: "same-origin",
          });
          const session = await response.json();
          authState = {
            checked: true,
            authenticated: Boolean(session.authenticated),
            demoMode: Boolean(session.demoMode),
            user: session.user || null,
            membership: session.membership || null,
            memberships: Array.isArray(session.memberships)
              ? session.memberships
              : session.membership
                ? [session.membership]
                : [],
            configurationRequired: Boolean(session.configurationRequired),
          };
        } catch (error) {
          authState = {
            checked: true,
            authenticated: false,
            demoMode: false,
            user: null,
            membership: null,
            memberships: [],
            error: true,
          };
        }

        updateAuthUi();
        return authState;
      }

      async function enterAdmin() {
        const session = await loadAdminSession(true);

        if (session.authenticated) {
          closeLoginModal();
          location.hash = "admin";
          show("admin");
          await hydrateRemoteCerts();
          await loadDashboardMetrics();
          return true;
        }

        location.hash = "";
        show("verify");

        if (session.configurationRequired) {
          openLoginModal(
            "نظام تسجيل الدخول غير مربوط بعد. أضف إعدادات Supabase Auth في بيئة التشغيل.",
          );
        } else {
          openLoginModal();
        }

        return false;
      }

      async function issueCertificateRemote(payload) {
        const response = await fetch(CERT_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify(payload),
        });

        const result = await response.json().catch(() => ({}));
        storageProvider = result.storage || storageProvider;

        if (!response.ok || !result.certificate) {
          if (response.status === 401) {
            authState.checked = false;
            await enterAdmin();
          }
          throw new Error(
            result.error || "تعذر إصدار الشهادة من السيرفر.",
          );
        }

        cloudSyncAvailable = Boolean(result.persisted);
        return result.certificate;
      }

      async function issueBulkCertificates(rows) {
        const response = await fetch(CERT_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ bulk: rows }),
        });

        const result = await response.json().catch(() => ({}));
        storageProvider = result.storage || storageProvider;

        if (!response.ok || !Array.isArray(result.certificates)) {
          throw new Error(
            result.row
              ? (result.error || "بيانات غير صالحة") +
                  " (الصف " +
                  result.row +
                  ")"
              : result.error || "تعذر الإصدار الجماعي.",
          );
        }

        return result.certificates;
      }

      async function updateCertificateRemote(serial, patch) {
        const response = await fetch(
          CERT_API + "?serial=" + encodeURIComponent(serial),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify(patch),
          },
        );

        const result = await response.json().catch(() => ({}));
        storageProvider = result.storage || storageProvider;

        if (!response.ok || !result.certificate) {
          if (response.status === 401) {
            authState.checked = false;
            await enterAdmin();
          }
          throw new Error(
            result.error || "تعذر تحديث الشهادة.",
          );
        }

        const current = find(serial) || {};
        return {
          ...current,
          ...result.certificate,
          serial: current.serial || result.certificate.serial || serial,
        };
      }

      function fileToDataUrl(file) {
        return new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error("تعذر قراءة الملف."));
          reader.readAsDataURL(file);
        });
      }

      async function uploadStorageAsset(kind, file, extra = {}) {
        if (!file) throw new Error("اختر ملفاً أولاً.");

        const dataUrl = await fileToDataUrl(file);
        const response = await fetch(STORAGE_API + "/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            kind,
            dataUrl,
            ...extra,
          }),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          if (response.status === 401) {
            authState.checked = false;
            await enterAdmin();
          }

          throw new Error(
            payload.error ||
              (response.status === 413
                ? "حجم الملف أكبر من الحد المسموح."
                : "تعذر رفع الملف إلى التخزين السحابي."),
          );
        }

        return payload;
      }

      async function loadStorageAssets() {
        const response = await fetch(STORAGE_API + "/assets", {
          cache: "no-store",
          credentials: "same-origin",
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            payload.error ||
              "التخزين السحابي غير مربوط حالياً.",
          );
        }

        return payload;
      }

      async function updateOrganizationBranding(settings) {
        const response = await fetch(STORAGE_API + "/assets", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ organization: settings }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.organization) {
          throw new Error(
            payload.error || "تعذر حفظ هوية المؤسسة.",
          );
        }

        return payload.organization;
      }

      async function setActiveTemplate(templateId) {
        const response = await fetch(STORAGE_API + "/assets", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ templateId }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "تعذر تفعيل القالب.");
        }
        return payload.template;
      }

      async function deleteStoredTemplate(templateId) {
        const response = await fetch(
          STORAGE_API + "/assets?id=" + encodeURIComponent(templateId),
          {
            method: "DELETE",
            credentials: "same-origin",
          },
        );

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "تعذر حذف القالب.");
        }
        return true;
      }

      async function hydrateRemoteCerts() {
        try {
          const response = await fetch(CERT_API, {
            cache: "no-store",
            credentials: "same-origin",
          });

          if (!response.ok) {
            if (response.status === 401) {
              authState.checked = false;
            }
            throw new Error("cloud storage unavailable");
          }

          const remote = await response.json();
          const remoteCerts = Array.isArray(remote.certificates)
            ? remote.certificates
            : [];

          storageProvider = remote.storage || "demo";
          cloudSyncAvailable = storageProvider !== "demo";

          if (storageProvider === "demo") {
            const map = new Map();
            [...remoteCerts, ...certs].forEach((cert) => {
              if (cert?.serial) map.set(cert.serial.toUpperCase(), cert);
            });
            certs = Array.from(map.values());
          } else {
            // In production the database is authoritative.
            certs = remoteCerts;
          }

          save();
          render();
        } catch (error) {
          cloudSyncAvailable = false;
          render();
        }
      }

      function updateDashboardStats() {
        const total = $("#total");
        const verified = $("#verified");
        const today = $("#verificationsToday");
        const attention = $("#attentionCount");

        if (dashboardMetrics && storageProvider !== "demo") {
          total.textContent =
            dashboardMetrics.certificatesTotal ?? certs.length;
          verified.textContent =
            dashboardMetrics.validCertificates ??
            certs.filter((item) => (item.status || "valid") === "valid").length;
          today.textContent =
            dashboardMetrics.verificationsToday ?? 0;
          attention.textContent =
            (Number(dashboardMetrics.revokedCertificates || 0) +
              Number(dashboardMetrics.expiredCertificates || 0));
          return;
        }

        total.textContent = certs.length;
        verified.textContent = certs.filter(
          (certificate) => (certificate.status || "valid") === "valid",
        ).length;
        today.textContent = "0";
        attention.textContent = certs.filter((certificate) =>
          ["revoked", "expired"].includes(
            String(certificate.status || "valid"),
          ),
        ).length;
      }

      async function loadDashboardMetrics() {
        try {
          const response = await fetch(
            CERT_API + "?report=dashboard",
            {
              cache: "no-store",
              credentials: "same-origin",
            },
          );
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error("metrics unavailable");
          dashboardMetrics = payload.metrics || null;
        } catch (error) {
          dashboardMetrics = null;
        }

        updateDashboardStats();
        return dashboardMetrics;
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

      function canManageCertificates() {
        if (authState.demoMode) return true;
        return ["owner", "admin", "issuer"].includes(
          authState.membership?.role,
        );
      }

      function render() {
        const q = $("#search").value?.toLowerCase() || "";
        const selectedStatus = $("#statusFilter")?.value || "";
        const rows = $("#rows");
        rows.replaceChildren();

        certs
          .filter((certificate) => {
            if (
              selectedStatus &&
              String(certificate.status || "valid").toLowerCase() !==
                selectedStatus
            ) {
              return false;
            }

            return (
              !q ||
              (certificate.name + certificate.serial + certificate.course)
                .toLowerCase()
                .includes(q)
            );
          })
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
            const actions = document.createElement("div");
            actions.className = "table-actions";

            const viewButton = document.createElement("button");
            viewButton.className = "link";
            viewButton.textContent = "عرض";
            viewButton.onclick = () => showCert(certificate);
            actions.appendChild(viewButton);

            if (canManageCertificates()) {
              const manageButton = document.createElement("button");
              manageButton.className = "link manage-link";
              manageButton.textContent = "إدارة";
              manageButton.onclick = () =>
                openCertificateManager(certificate);
              actions.appendChild(manageButton);
            }

            actionTd.appendChild(actions);
            tr.appendChild(actionTd);
            rows.appendChild(tr);
          });

        updateDashboardStats();
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
      function verificationUrlFor(serial, issuer = null) {
        const origin = issuer?.customDomain
          ? "https://" + issuer.customDomain
          : location.origin;

        return (
          origin +
          location.pathname +
          "#certificate/" +
          encodeURIComponent(serial)
        );
      }

      function renderOfficialQr(certificate) {
        const target = $("#officialQr");
        const urlTarget = $("#officialQrUrl");
        if (!target || !urlTarget) return;

        const url = verificationUrlFor(
          certificate.serial,
          certificate.issuer,
        );
        urlTarget.textContent = url;
        target.replaceChildren();

        if (window.QRCode) {
          new window.QRCode(target, {
            text: url,
            width: 132,
            height: 132,
            colorDark: "#0b2b34",
            colorLight: "#ffffff",
            correctLevel:
              window.QRCode.CorrectLevel?.H ?? 2,
          });
        } else {
          const fallback = document.createElement("code");
          fallback.textContent = certificate.serial;
          target.appendChild(fallback);
        }
      }

      function buildCertificatePdf(c) {
        const { jsPDF } = window.jspdf;
        let d = new jsPDF({ orientation: "landscape" });
        d.setFillColor(15, 31, 58);
        d.rect(0, 0, 297, 38, "F");
        d.setTextColor(255);
        d.setFontSize(24);
        const issuerName =
          c.issuer?.name || "DevsHub Academy.cc";
        d.text(issuerName + " - Certificate of Completion", 148, 24, { align: "center" });
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
        d.text("Issued: " + c.date + " | Verified by " + issuerName, 148, 168, { align: "center" });

        const qrCanvas = $("#officialQr canvas");
        const qrImage = $("#officialQr img");
        try {
          if (qrCanvas) {
            d.addImage(
              qrCanvas.toDataURL("image/png"),
              "PNG",
              250,
              145,
              26,
              26,
            );
          } else if (qrImage?.src) {
            d.addImage(qrImage.src, "PNG", 250, 145, 26, 26);
          }
        } catch (error) {}

        d.setFontSize(7);
        d.text("Scan to verify", 263, 176, { align: "center" });
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
        $("#certIssuer").textContent =
          c.issuer?.name || "DevsHub Academy.cc";
        const resultIssuer = document.querySelector(
          ".result-issuer b",
        );
        if (resultIssuer) {
          resultIssuer.textContent =
            c.issuer?.name || "DevsHub Academy.cc";
        }

        const issuerLogo = $("#certIssuerLogo");
        if (issuerLogo) {
          if (c.issuer?.logoUrl) {
            issuerLogo.src = c.issuer.logoUrl;
            issuerLogo.hidden = false;
          } else {
            issuerLogo.hidden = true;
            issuerLogo.removeAttribute("src");
          }
        }

        document.documentElement.style.setProperty(
          "--issuer-primary",
          c.issuer?.primaryColor || "#0B7783",
        );
        document.documentElement.style.setProperty(
          "--issuer-secondary",
          c.issuer?.secondaryColor || "#0B2B34",
        );

        applyPublicStatus(c);
        loadPdfPreview(c);
        renderOfficialQr(c);
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

      async function fetchCertificateBySerial(serial, source = "serial") {
        const response = await fetch(
          CERT_API +
            "?serial=" +
            encodeURIComponent(serial) +
            "&source=" +
            encodeURIComponent(source),
          {
            cache: "no-store",
            credentials: "same-origin",
          },
        );

        const payload = await response.json().catch(() => ({}));
        storageProvider = payload.storage || storageProvider;

        if (response.status === 404) return null;
        if (!response.ok) {
          throw new Error("verification request failed");
        }

        return payload.certificate || null;
      }

      async function verifySerial(value, source = "serial") {
        const serial = String(value || "").trim().toUpperCase();
        if (!serial) {
          $("#badSerial").textContent = "اكتب الرقم التسلسلي أولاً";
          $("#resultModal").classList.add("show");
          return false;
        }

        $("#serial").value = serial;
        setVerifyLoading(true);

        try {
          let certificate = null;

          try {
            certificate = await fetchCertificateBySerial(serial, source);
          } catch (error) {
            if (storageProvider !== "demo") throw error;
          }

          if (!certificate && storageProvider === "demo") {
            certificate = find(serial);
          }

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
      $('.role[data-v="admin"]').onclick = enterAdmin;

      $("#loginForm").onsubmit = async (event) => {
        event.preventDefault();

        const email = $("#loginEmail").value.trim();
        const password = $("#loginPassword").value;
        const button = $("#loginBtn");

        showLoginError("");
        button.disabled = true;
        button.textContent = "جاري تسجيل الدخول…";

        try {
          const response = await fetch(AUTH_API + "/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ email, password }),
          });

          const payload = await response.json().catch(() => ({}));

          if (!response.ok || !payload.authenticated) {
            if (payload.configurationRequired) {
              throw new Error("نظام تسجيل الدخول غير مربوط بعد ببيئة التشغيل.");
            }
            throw new Error(
              response.status === 403
                ? "هذا الحساب غير مرتبط بمؤسسة مخولة."
                : "البريد الإلكتروني أو كلمة المرور غير صحيحة.",
            );
          }

          authState = {
            checked: true,
            authenticated: true,
            demoMode: Boolean(payload.demoMode),
            user: payload.user || null,
            membership: payload.membership || null,
            memberships: Array.isArray(payload.memberships)
              ? payload.memberships
              : payload.membership
                ? [payload.membership]
                : [],
          };
          updateAuthUi();
          closeLoginModal();
          location.hash = "admin";
          show("admin");
          await hydrateRemoteCerts();
          await loadDashboardMetrics();
          $("#loginPassword").value = "";
        } catch (error) {
          showLoginError(error.message || "تعذر تسجيل الدخول.");
        } finally {
          button.disabled = false;
          button.textContent = "دخول إلى الإدارة";
        }
      };

      $("#closeLogin").onclick = () => {
        closeLoginModal();
        location.hash = "";
        show("verify");
      };

      $("#orgSwitcher").onchange = async (event) => {
        const slug = event.target.value;
        if (!slug) return;

        event.target.disabled = true;
        try {
          const response = await fetch(AUTH_API + "/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ organizationSlug: slug }),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !payload.authenticated) {
            throw new Error(
              payload.error || "تعذر تبديل المؤسسة.",
            );
          }

          authState = {
            checked: true,
            authenticated: true,
            demoMode: false,
            user: payload.user || authState.user,
            membership: payload.membership || null,
            memberships: Array.isArray(payload.memberships)
              ? payload.memberships
              : [],
          };
          dashboardMetrics = null;
          updateAuthUi();
          await hydrateRemoteCerts();
          await loadDashboardMetrics();
        } catch (error) {
          alert(error.message || "تعذر تبديل المؤسسة.");
          updateAuthUi();
        } finally {
          event.target.disabled = false;
        }
      };

      $("#logoutBtn").onclick = async () => {
        await fetch(AUTH_API + "/logout", {
          method: "POST",
          credentials: "same-origin",
        }).catch(() => {});

        authState = {
          checked: true,
          authenticated: false,
          demoMode: false,
          user: null,
          membership: null,
          memberships: [],
        };
        dashboardMetrics = null;
        updateAuthUi();
        location.hash = "";
        show("verify");
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
      $("#statusFilter").onchange = render;
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
      function createManagerField(labelText, control) {
        const wrapper = document.createElement("div");
        wrapper.className = "field";
        const label = document.createElement("label");
        label.textContent = labelText;
        wrapper.append(label, control);
        return wrapper;
      }

      function openCertificateManager(certificate) {
        const dialog = $("#adminToolModal");
        const body = $("#adminToolBody");
        const primary = $("#adminToolPrimary");

        $("#adminToolTitle").textContent =
          "إدارة الشهادة " + certificate.serial;
        body.replaceChildren();

        const name = document.createElement("input");
        name.value = certificate.name || "";

        const course = document.createElement("input");
        course.value = certificate.course || "";

        const expiry = document.createElement("input");
        expiry.type = "date";
        expiry.value = certificate.expiresAt || "";

        const status = document.createElement("select");
        [
          ["valid", "صالحة"],
          ["revoked", "ملغاة"],
          ["expired", "منتهية"],
        ].forEach(([value, label]) => {
          const option = document.createElement("option");
          option.value = value;
          option.textContent = label;
          status.appendChild(option);
        });
        status.value = certificate.status || "valid";

        const reason = document.createElement("input");
        reason.placeholder = "سبب الإلغاء (اختياري)";
        reason.value = certificate.revokedReason || "";

        const serial = document.createElement("code");
        serial.className = "serial";
        serial.textContent = certificate.serial;

        const serialField = document.createElement("div");
        serialField.className = "field";
        const serialLabel = document.createElement("label");
        serialLabel.textContent = "Certificate ID";
        serialField.append(serialLabel, serial);

        const reasonField = createManagerField("سبب الإلغاء", reason);
        const syncReasonVisibility = () => {
          reasonField.hidden = status.value !== "revoked";
        };
        status.onchange = syncReasonVisibility;
        syncReasonVisibility();

        body.append(
          serialField,
          createManagerField("اسم المتدرب", name),
          createManagerField("اسم الدورة", course),
          createManagerField("تاريخ الانتهاء", expiry),
          createManagerField("حالة الشهادة", status),
          reasonField,
        );

        primary.textContent = "حفظ التغييرات";
        primary.onclick = async () => {
          const patch = {
            name: name.value.trim(),
            course: course.value.trim(),
            expiresAt: expiry.value || null,
            status: status.value,
            revokedReason:
              status.value === "revoked" ? reason.value.trim() : "",
          };

          if (!patch.name || !patch.course) {
            alert("اسم المتدرب واسم الدورة مطلوبان.");
            return;
          }

          primary.disabled = true;
          primary.textContent = "جاري الحفظ…";

          try {
            const updated = await updateCertificateRemote(
              certificate.serial,
              patch,
            );

            const index = certs.findIndex(
              (item) => item.serial === certificate.serial,
            );
            if (index >= 0) certs[index] = updated;
            else certs.unshift(updated);

            save();
            render();
            closeAdminTool();
          } catch (error) {
            alert(error.message || "تعذر تحديث الشهادة.");
          } finally {
            primary.disabled = false;
            primary.textContent = "حفظ التغييرات";
          }
        };

        dialog.classList.add("show");
      }

      function modalField(labelText, control) {
        const wrapper = document.createElement("div");
        wrapper.className = "field";
        const label = document.createElement("label");
        label.textContent = labelText;
        wrapper.append(label, control);
        return wrapper;
      }

      function storageMessage(text, type = "info") {
        const message = document.createElement("div");
        message.className = "storage-message storage-message-" + type;
        message.textContent = text;
        return message;
      }

      async function renderTemplateStorageList(container) {
        container.replaceChildren(
          storageMessage("جاري تحميل القوالب…"),
        );

        try {
          const assets = await loadStorageAssets();
          const templates = Array.isArray(assets.templates)
            ? assets.templates
            : [];

          container.replaceChildren();

          if (!templates.length) {
            container.append(
              storageMessage("لا توجد قوالب مرفوعة بعد."),
            );
            return;
          }

          templates.forEach((template) => {
            const card = document.createElement("div");
            card.className =
              "storage-template-card" +
              (template.isActive ? " is-active" : "");

            const info = document.createElement("div");
            const title = document.createElement("b");
            title.textContent = template.name;
            const meta = document.createElement("small");
            meta.textContent =
              (template.fileType || "file") +
              (template.isActive ? " · ACTIVE" : "");
            info.append(title, meta);

            const actions = document.createElement("div");

            const open = document.createElement("button");
            open.className = "link";
            open.textContent = "فتح";
            open.onclick = () =>
              window.open(template.fileUrl, "_blank", "noopener");

            const activate = document.createElement("button");
            activate.className = "link manage-link";
            activate.textContent = template.isActive ? "نشط" : "تفعيل";
            activate.disabled = Boolean(template.isActive);
            activate.onclick = async () => {
              activate.disabled = true;
              try {
                await setActiveTemplate(template.id);
                await renderTemplateStorageList(container);
              } catch (error) {
                alert(error.message);
                activate.disabled = false;
              }
            };

            const remove = document.createElement("button");
            remove.className = "link storage-delete";
            remove.textContent = "حذف";
            remove.onclick = async () => {
              if (!confirm("حذف هذا القالب من التخزين السحابي؟")) return;
              remove.disabled = true;
              try {
                await deleteStoredTemplate(template.id);
                await renderTemplateStorageList(container);
              } catch (error) {
                alert(error.message);
                remove.disabled = false;
              }
            };

            actions.append(open, activate, remove);
            card.append(info, actions);
            container.append(card);
          });
        } catch (error) {
          container.replaceChildren(
            storageMessage(error.message, "error"),
          );
        }
      }

      async function openTemplateStorageManager() {
        const modal = $("#adminToolModal");
        const body = $("#adminToolBody");
        const primary = $("#adminToolPrimary");

        $("#adminToolTitle").textContent = "قوالب الشهادات";
        body.replaceChildren();

        const name = document.createElement("input");
        name.placeholder = "مثال: القالب المهني الرسمي";

        const file = document.createElement("input");
        file.type = "file";
        file.accept = "application/pdf,image/png,image/jpeg,image/webp";

        const active = document.createElement("input");
        active.type = "checkbox";
        const activeLabel = document.createElement("label");
        activeLabel.className = "storage-checkbox";
        activeLabel.append(active, document.createTextNode(" تفعيل القالب بعد الرفع"));

        const note = storageMessage(
          "القوالب تحفظ داخل Private Supabase Storage. الحد الحالي 2.5MB للملف.",
        );

        const list = document.createElement("div");
        list.className = "storage-template-list";

        body.append(
          modalField("اسم القالب", name),
          modalField("ملف القالب (PDF أو صورة)", file),
          activeLabel,
          note,
          list,
        );

        primary.textContent = "رفع القالب";
        primary.disabled = false;
        primary.onclick = async () => {
          if (!name.value.trim() || !file.files[0]) {
            alert("اكتب اسم القالب واختر ملفاً.");
            return;
          }

          primary.disabled = true;
          primary.textContent = "جاري الرفع…";

          try {
            await uploadStorageAsset("template", file.files[0], {
              name: name.value.trim(),
              isActive: active.checked,
            });
            name.value = "";
            file.value = "";
            active.checked = false;
            await renderTemplateStorageList(list);
          } catch (error) {
            alert(error.message);
          } finally {
            primary.disabled = false;
            primary.textContent = "رفع القالب";
          }
        };

        modal.classList.add("show");
        await renderTemplateStorageList(list);
      }

      async function openBrandingStorageManager() {
        const modal = $("#adminToolModal");
        const body = $("#adminToolBody");
        const primary = $("#adminToolPrimary");

        $("#adminToolTitle").textContent = "هوية المؤسسة والشعار";
        body.replaceChildren();

        const previewWrap = document.createElement("div");
        previewWrap.className = "storage-logo-preview";
        previewWrap.append(
          storageMessage("جاري تحميل بيانات المؤسسة…"),
        );

        const displayName = document.createElement("input");
        displayName.placeholder = "اسم المؤسسة الظاهر";

        const customDomain = document.createElement("input");
        customDomain.placeholder = "verify.example.com";
        customDomain.dir = "ltr";

        const primaryColor = document.createElement("input");
        primaryColor.type = "color";
        primaryColor.value = "#0B7783";

        const secondaryColor = document.createElement("input");
        secondaryColor.type = "color";
        secondaryColor.value = "#0B2B34";

        const file = document.createElement("input");
        file.type = "file";
        file.accept = "image/png,image/jpeg,image/webp";

        body.append(
          previewWrap,
          modalField("اسم المؤسسة الظاهر", displayName),
          modalField("الدومين المخصص (اختياري)", customDomain),
          modalField("اللون الأساسي", primaryColor),
          modalField("اللون الثانوي", secondaryColor),
          modalField("رفع / استبدال الشعار", file),
          storageMessage(
            "الدومين يُحفظ كإعداد للمؤسسة. ربط DNS/Vercel يتم عند تفعيل الدومين فعلياً.",
          ),
        );

        async function refreshBranding() {
          try {
            const assets = await loadStorageAssets();
            const org = assets.organization || {};

            displayName.value =
              org.displayName || org.name || "";
            customDomain.value = org.customDomain || "";
            primaryColor.value =
              org.primaryColor || "#0B7783";
            secondaryColor.value =
              org.secondaryColor || "#0B2B34";

            previewWrap.replaceChildren();

            if (org.logoUrl) {
              const img = document.createElement("img");
              img.src =
                org.logoUrl +
                (org.logoUrl.includes("?") ? "&" : "?") +
                "t=" +
                Date.now();
              img.alt = "Organization logo";

              const text = document.createElement("div");
              const name = document.createElement("b");
              name.textContent =
                org.displayName || org.name || "Organization";
              const slug = document.createElement("small");
              slug.textContent =
                (org.slug || "") +
                (org.customDomain
                  ? " · " + org.customDomain
                  : "");
              text.append(name, slug);
              previewWrap.append(img, text);
            } else {
              const text = document.createElement("div");
              const name = document.createElement("b");
              name.textContent =
                org.displayName || org.name || "Organization";
              const slug = document.createElement("small");
              slug.textContent = org.slug || "";
              text.append(name, slug);
              previewWrap.append(text);
            }
          } catch (error) {
            previewWrap.replaceChildren(
              storageMessage(error.message, "error"),
            );
          }
        }

        primary.textContent = "حفظ الهوية";
        primary.disabled = false;
        primary.onclick = async () => {
          primary.disabled = true;
          primary.textContent = "جاري الحفظ…";

          try {
            const updated = await updateOrganizationBranding({
              displayName: displayName.value.trim(),
              customDomain: customDomain.value.trim(),
              primaryColor: primaryColor.value,
              secondaryColor: secondaryColor.value,
            });

            if (file.files[0]) {
              await uploadStorageAsset("logo", file.files[0]);
              file.value = "";
            }

            if (authState.membership?.organization) {
              authState.membership.organization = {
                ...authState.membership.organization,
                ...updated,
                display_name:
                  updated.display_name ||
                  displayName.value.trim(),
              };
            }

            authState.memberships = authState.memberships.map(
              (item) =>
                item.organization?.id === updated.id
                  ? {
                      ...item,
                      organization: {
                        ...item.organization,
                        ...updated,
                      },
                    }
                  : item,
            );

            updateAuthUi();
            await refreshBranding();
          } catch (error) {
            alert(error.message);
          } finally {
            primary.disabled = false;
            primary.textContent = "حفظ الهوية";
          }
        };

        modal.classList.add("show");
        await refreshBranding();
      }

      function normalizeBulkRow(row) {
        const entries = Object.entries(row || {});
        const normalized = {};
        entries.forEach(([key, value]) => {
          normalized[
            String(key)
              .trim()
              .toLowerCase()
              .replace(/\s+/g, "_")
          ] = value;
        });

        const valueOf = (...keys) => {
          for (const key of keys) {
            if (
              normalized[key] !== undefined &&
              normalized[key] !== null &&
              String(normalized[key]).trim() !== ""
            ) {
              return String(normalized[key]).trim();
            }
          }
          return "";
        };

        return {
          name: valueOf(
            "name",
            "student",
            "student_name",
            "full_name",
            "اسم_المتدرب",
            "الاسم",
          ),
          course: valueOf(
            "course",
            "course_name",
            "اسم_الدورة",
            "الدورة",
          ),
          prefix: valueOf("prefix", "code_prefix") || "DVH",
          date: valueOf(
            "date",
            "issued_at",
            "issue_date",
            "تاريخ_الإصدار",
          ) || new Date().toISOString().slice(0, 10),
          expiresAt:
            valueOf(
              "expiresat",
              "expires_at",
              "expiry_date",
              "تاريخ_الانتهاء",
            ) || null,
          status: "valid",
        };
      }

      async function parseBulkFile(file) {
        if (!file) return [];
        if (!window.XLSX) {
          throw new Error("تعذر تحميل قارئ Excel/CSV.");
        }

        const bytes = await file.arrayBuffer();
        const workbook = window.XLSX.read(bytes, {
          type: "array",
          cellDates: false,
        });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(sheet, {
          defval: "",
          raw: false,
        });

        return rows
          .map(normalizeBulkRow)
          .filter((row) => row.name || row.course);
      }

      async function openBulkIssuanceManager() {
        const modal = $("#adminToolModal");
        const body = $("#adminToolBody");
        const primary = $("#adminToolPrimary");

        $("#adminToolTitle").textContent = "الإصدار الجماعي";
        body.replaceChildren();

        const file = document.createElement("input");
        file.type = "file";
        file.accept = ".csv,.xlsx,.xls";

        const preview = document.createElement("div");
        preview.className = "bulk-preview";
        preview.append(
          storageMessage(
            "ارفع CSV أو Excel. الأعمدة المطلوبة: name و course. ويمكن إضافة prefix و date و expiresAt.",
          ),
        );

        const sample = document.createElement("button");
        sample.className = "soft bulk-sample";
        sample.type = "button";
        sample.textContent = "تنزيل نموذج CSV";
        sample.onclick = () => {
          const content =
            "name,course,prefix,date,expiresAt\n" +
            "Ahmed Ali,Web Development Essentials,DVH," +
            new Date().toISOString().slice(0, 10) +
            ",\n";
          const blob = new Blob([content], {
            type: "text/csv;charset=utf-8",
          });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = "devshub-bulk-template.csv";
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        };

        let parsedRows = [];

        file.onchange = async () => {
          preview.replaceChildren(
            storageMessage("جاري قراءة الملف…"),
          );
          try {
            parsedRows = await parseBulkFile(file.files[0]);
            if (!parsedRows.length) {
              throw new Error("لم يتم العثور على صفوف صالحة.");
            }
            if (parsedRows.length > 200) {
              throw new Error("الحد الأقصى 200 شهادة في الدفعة الواحدة.");
            }

            const invalid = parsedRows.findIndex(
              (row) => !row.name || !row.course,
            );
            if (invalid >= 0) {
              throw new Error(
                "الصف " +
                  (invalid + 2) +
                  " ينقصه الاسم أو الدورة.",
              );
            }

            const table = document.createElement("div");
            table.className = "bulk-preview-list";
            parsedRows.slice(0, 8).forEach((row, index) => {
              const item = document.createElement("div");
              const num = document.createElement("b");
              num.textContent = String(index + 1).padStart(2, "0");
              const text = document.createElement("span");
              text.textContent = row.name + " — " + row.course;
              item.append(num, text);
              table.appendChild(item);
            });

            preview.replaceChildren(
              storageMessage(
                "جاهز للإصدار: " +
                  parsedRows.length +
                  " شهادة.",
              ),
              table,
            );
          } catch (error) {
            parsedRows = [];
            preview.replaceChildren(
              storageMessage(error.message, "error"),
            );
          }
        };

        body.append(
          modalField("ملف CSV / Excel", file),
          sample,
          preview,
        );

        primary.textContent = "إصدار الشهادات";
        primary.disabled = false;
        primary.onclick = async () => {
          if (!parsedRows.length) {
            alert("اختر ملفاً صالحاً أولاً.");
            return;
          }

          primary.disabled = true;
          primary.textContent = "جاري الإصدار…";

          try {
            const issued = await issueBulkCertificates(parsedRows);
            if (storageProvider === "demo") {
              certs = [...issued, ...certs];
            } else {
              await hydrateRemoteCerts();
            }
            save();
            render();
            await loadDashboardMetrics();
            preview.prepend(
              storageMessage(
                "تم إصدار " +
                  issued.length +
                  " شهادة بنجاح.",
              ),
            );
            parsedRows = [];
            file.value = "";
          } catch (error) {
            alert(error.message || "تعذر الإصدار الجماعي.");
          } finally {
            primary.disabled = false;
            primary.textContent = "إصدار الشهادات";
          }
        };

        modal.classList.add("show");
      }

      function metricCard(label, value) {
        const card = document.createElement("div");
        card.className = "report-metric-card";
        const small = document.createElement("span");
        small.textContent = label;
        const strong = document.createElement("b");
        strong.textContent = String(value ?? 0);
        card.append(small, strong);
        return card;
      }

      async function openReportsManager() {
        const modal = $("#adminToolModal");
        const body = $("#adminToolBody");
        const primary = $("#adminToolPrimary");

        $("#adminToolTitle").textContent = "التقارير والتحليلات";
        body.replaceChildren(
          storageMessage("جاري تحميل بيانات التقارير…"),
        );
        primary.textContent = "تحديث التقرير";
        primary.disabled = true;
        modal.classList.add("show");

        async function refresh() {
          primary.disabled = true;
          try {
            const metrics = await loadDashboardMetrics();
            const m = metrics || {};

            const grid = document.createElement("div");
            grid.className = "report-metric-grid";
            grid.append(
              metricCard("إجمالي الشهادات", m.certificatesTotal ?? certs.length),
              metricCard("صالحة", m.validCertificates ?? 0),
              metricCard("ملغاة", m.revokedCertificates ?? 0),
              metricCard("منتهية", m.expiredCertificates ?? 0),
              metricCard("صدرت هذا الشهر", m.issuedThisMonth ?? 0),
              metricCard("تحققات اليوم", m.verificationsToday ?? 0),
              metricCard("تحققات 30 يوم", m.verifications30d ?? 0),
              metricCard("QR اليوم", m.qrToday ?? 0),
              metricCard("Serial اليوم", m.serialToday ?? 0),
              metricCard("Direct links", m.directToday ?? 0),
            );

            const chart = document.createElement("div");
            chart.className = "report-bar-chart";
            const daily = Array.isArray(m.daily30d)
              ? m.daily30d
              : [];
            const max = Math.max(
              1,
              ...daily.map((item) => Number(item.count || 0)),
            );
            daily.forEach((item) => {
              const bar = document.createElement("i");
              bar.style.height =
                Math.max(
                  4,
                  Math.round((Number(item.count || 0) / max) * 100),
                ) + "%";
              bar.title =
                String(item.date || "") +
                ": " +
                String(item.count || 0);
              chart.appendChild(bar);
            });

            const chartWrap = document.createElement("div");
            chartWrap.className = "report-chart-wrap";
            const title = document.createElement("b");
            title.textContent = "نشاط التحقق — آخر 30 يوم";
            chartWrap.append(title, chart);

            body.replaceChildren(grid, chartWrap);
          } catch (error) {
            body.replaceChildren(
              storageMessage(
                "تعذر تحميل التقارير حالياً.",
                "error",
              ),
            );
          } finally {
            primary.disabled = false;
          }
        }

        primary.onclick = refresh;
        await refresh();
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
        if (view === "bulk") {
          openBulkIssuanceManager();
          return;
        }

        if (view === "reports") {
          openReportsManager();
          return;
        }

        if (view === "templates") {
          openTemplateStorageManager();
          return;
        }

        if (view === "settings") {
          openBrandingStorageManager();
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
          loadDashboardMetrics();
          return;
        }
        const tools = {
        };
        const tool = tools[view];
        if (tool) openAdminTool(tool[0], tool[1], tool[2]);
      }
      document.querySelectorAll("[data-admin-view]").forEach((button) => {
        button.onclick = () => setAdminView(button.dataset.adminView);
      });
      $("#closeAdminTool").onclick = closeAdminTool;
      $("#saveCert").onclick = async () => {
        const name = $("#newName").value.trim();
        const course = $("#newCourse").value.trim();
        const expiresAt = $("#newExpiresAt").value || null;
        const prefix = cleanPrefix();
        const button = $("#saveCert");

        if (!name || !course) {
          alert("اكتب اسم المتدرب والدورة");
          return;
        }

        let localPdf;
        const pdfFile = $("#newPdf").files[0];

        if (pdfFile) {
          if (
            pdfFile.type !== "application/pdf" ||
            pdfFile.size > 2500000
          ) {
            alert("اختر ملف PDF صالحاً وأصغر من 2.5MB.");
            return;
          }

          localPdf = await fileToDataUrl(pdfFile);
        }

        button.disabled = true;
        button.textContent = "جاري إصدار الشهادة…";

        try {
          const issued = await issueCertificateRemote({
            name,
            course,
            prefix,
            date: new Date().toISOString().slice(0, 10),
            expiresAt,
            status: "valid",
          });

          let certificate = { ...issued };
          let pdfUploadWarning = "";

          if (localPdf) {
            if (storageProvider === "postgresql") {
              try {
                const uploaded = await uploadStorageAsset(
                  "certificate",
                  pdfFile,
                  { serial: issued.serial },
                );
                certificate = {
                  ...certificate,
                  ...(uploaded.certificate || {}),
                };
              } catch (error) {
                pdfUploadWarning =
                  " تم إصدار الشهادة، لكن تعذر رفع ملف PDF: " +
                  error.message;
              }
            } else {
              certificate.pdf = localPdf;
            }
          }

          const existing = certs.findIndex(
            (item) => item.serial === certificate.serial,
          );
          if (existing >= 0) certs[existing] = certificate;
          else certs.unshift(certificate);

          save();
          render();
          await loadDashboardMetrics();

          $("#addModal").classList.remove("show");
          $("#newName").value = "";
          $("#newCourse").value = "";
          $("#newExpiresAt").value = "";
          $("#newPdf").value = "";
          refreshSerialSuggestion();

          alert(
            "تم إنشاء الشهادة بنجاح. كود التحقق: " +
              certificate.serial +
              pdfUploadWarning,
          );
        } catch (error) {
          alert(error.message || "تعذر إصدار الشهادة.");
        } finally {
          button.disabled = false;
          button.textContent = "حفظ وإنشاء سيريال";
        }
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
        await verifySerial(serial, "qr");
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

      $("#downloadQrBtn").onclick = () => {
        if (!active) return;

        const canvas = $("#officialQr canvas");
        const image = $("#officialQr img");
        let href = "";

        if (canvas) {
          href = canvas.toDataURL("image/png");
        } else if (image?.src) {
          href = image.src;
        }

        if (!href) {
          alert("تعذر تجهيز QR حالياً.");
          return;
        }

        const a = document.createElement("a");
        a.href = href;
        a.download = active.serial + "-QR.png";
        document.body.appendChild(a);
        a.click();
        a.remove();
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
          let certificate = null;

          try {
            certificate = await fetchCertificateBySerial(serial, "direct_link");
          } catch (error) {}

          if (!certificate && storageProvider === "demo") {
            certificate = find(serial);
          }

          if (certificate) showCert(certificate);
          else show("verify");
          return;
        }

        if (location.hash === "#admin") {
          await enterAdmin();
        }
      }

      initializeApp();
