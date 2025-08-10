package com.example.backendspring.caixa;

import com.example.backendspring.user.UserRepository;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.LinkedHashMap;

@RestController
@RequestMapping("/api/caixa")
@RequiredArgsConstructor
public class CaixaController {

    private final CaixaStatusRepository caixaStatusRepository;
    private final UserRepository userRepository;

    private static final String KEY_ERROR = "error";
    private static final String KEY_MESSAGE = "message";
    private static final String MSG_NAO_AUTENTICADO = "Usuário não autenticado";

    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> status() {
        return caixaStatusRepository.findTopByOrderByIdDesc()
                .map(cs -> {
                    Map<String, Object> body = new LinkedHashMap<>();
                    body.put("id", cs.getId());
                    body.put("aberto", Boolean.TRUE.equals(cs.getAberto()));
                    body.put("horario_abertura_obrigatorio", cs.getHorarioAberturaObrigatorio());
                    body.put("horario_fechamento_obrigatorio", cs.getHorarioFechamentoObrigatorio());
                    body.put("aberto_por", cs.getAbertoPor() != null ? cs.getAbertoPor().getId() : null);
                    body.put("fechado_por", cs.getFechadoPor() != null ? cs.getFechadoPor().getId() : null);
                    body.put("data_abertura", cs.getDataAbertura());
                    body.put("data_fechamento", cs.getDataFechamento());
                    body.put("criado_em", cs.getCriadoEm());
                    body.put("atualizado_em", cs.getAtualizadoEm());
                    body.put("aberto_por_username", cs.getAbertoPor() != null ? cs.getAbertoPor().getUsername() : null);
                    body.put("fechado_por_username",
                            cs.getFechadoPor() != null ? cs.getFechadoPor().getUsername() : null);
                    return ResponseEntity.ok(body);
                })
                .orElse(ResponseEntity.ok(Map.of("id", 1, "aberto", false)));
    }

    @PostMapping("/abrir")
    @Transactional
    public ResponseEntity<Map<String, Object>> abrir(@RequestAttribute(name = "userId", required = false) Long userId) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        var statusOpt = caixaStatusRepository.findTopByOrderByIdDesc();
        if (statusOpt.isPresent() && Boolean.TRUE.equals(statusOpt.get().getAberto())) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Caixa já está aberto"));
        }
        var agora = OffsetDateTime.now();
        CaixaStatus status = statusOpt.orElseGet(CaixaStatus::new);
        status.setAberto(true);
        status.setAbertoPor(userRepository.findById(userId).orElse(null));
        status.setDataAbertura(agora);
        status.setFechadoPor(null);
        status.setDataFechamento(null);
        status.setAtualizadoEm(agora);
        if (status.getId() == null)
            status.setCriadoEm(agora);
        caixaStatusRepository.save(status);
        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Caixa aberto com sucesso"));
    }

    @PostMapping("/fechar")
    @Transactional
    public ResponseEntity<Map<String, Object>> fechar(
            @RequestAttribute(name = "userId", required = false) Long userId) {
        if (userId == null)
            return ResponseEntity.status(401).body(Map.of(KEY_ERROR, MSG_NAO_AUTENTICADO));
        var status = caixaStatusRepository.findTopByOrderByIdDesc().orElse(null);
        if (status == null || !Boolean.TRUE.equals(status.getAberto())) {
            return ResponseEntity.badRequest().body(Map.of(KEY_ERROR, "Caixa já está fechado"));
        }
        var agora = OffsetDateTime.now();
        status.setAberto(false);
        status.setFechadoPor(userRepository.findById(userId).orElse(null));
        status.setDataFechamento(agora);
        status.setAtualizadoEm(agora);
        caixaStatusRepository.save(status);
        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Caixa fechado com sucesso"));
    }

    @PutMapping("/horarios")
    @Transactional
    public ResponseEntity<Map<String, Object>> configurar(@RequestBody HorariosRequest req) {
        var statusOpt = caixaStatusRepository.findTopByOrderByIdDesc();
        var agora = OffsetDateTime.now();
        CaixaStatus status = statusOpt.orElseGet(CaixaStatus::new);
        status.setHorarioAberturaObrigatorio(req.getHorarioAberturaObrigatorio());
        status.setHorarioFechamentoObrigatorio(req.getHorarioFechamentoObrigatorio());
        status.setAtualizadoEm(agora);
        if (status.getId() == null)
            status.setCriadoEm(agora);
        caixaStatusRepository.save(status);
        return ResponseEntity.ok(Map.of(KEY_MESSAGE, "Horários configurados com sucesso"));
    }

    @Data
    public static class HorariosRequest {
        private String horarioAberturaObrigatorio;
        private String horarioFechamentoObrigatorio;
    }
}
