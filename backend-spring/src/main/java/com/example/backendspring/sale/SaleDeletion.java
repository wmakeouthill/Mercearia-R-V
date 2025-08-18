package com.example.backendspring.sale;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@Entity
@Table(name = "sale_deletions")
public class SaleDeletion {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "sale_id")
    private Long saleId;

    @Column(name = "sale_type")
    private String saleType; // 'legacy' or 'checkout'

    @Column(name = "payload", columnDefinition = "text")
    private String payload;

    @Column(name = "deleted_by")
    private String deletedBy;

    @Column(name = "deleted_at")
    private OffsetDateTime deletedAt;
}
